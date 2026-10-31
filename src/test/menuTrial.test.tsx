/**
 * メニューの体験予約（例: マシンピラティス専用の体験予約ページ）（2026-10-31）。
 * `supabase/migrations/20261031010000_menu_trials.sql`・src/lib/menuTrial.ts・
 * supabase/functions/_shared/trialRules.ts・supabase/functions/trial-book
 *
 * 宗本さん「マシンピラティス専用の体験予約受付サイトをつくってほしい。
 *           マシンピラティスの時間の枠だけが表示されるように」
 *
 * 🔴 壊しやすいもの:
 *   1. 体験に担当を入れるトリガーが、重なりの検査より後に動く（名前の順に動く）→ 先生の二重予約
 *   2. 作り直した3つの関数（重なり・専用の時間・埋まり枠）の、足した部分以外が変わる
 *   3. 公開ページ（src/lib/menuTrial.ts 他）とサーバー（_shared/trialRules.ts）の答えがずれる
 *      → 画面に出ている枠を送ると断られる（実際に 22:30 閉店の店の 21:15・21:30 で起きていた）
 *   4. メニューの体験のページに、トレーニングの体験の案内文・料金・枠を出す
 *   5. 代表のメールのキー（cancel-trainer-<id> / booking-notify-<id>）を先生への通知に使う → 送り直される
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import {
  bookingSlotMinutes,
  resolveDayBusinessMinutes as clientDayMinutes,
  type OperatingHours,
} from "@/lib/businessHours";
import { staffBookingSlotMinutes, staffDayMinutes } from "@/lib/staffSchedule";
import { normalizeBookingWindowDays } from "@/lib/bookingWindow";
import { formatYen } from "@/lib/trialPricing";
import {
  isBeforeMenuStart, menuStartLabel, menuTrialPath, menuTrialSlotMinutes, menuTrialWindowEndKey, parseMenuTrial,
} from "@/lib/menuTrial";
import * as server from "../../supabase/functions/_shared/trialRules";
import { REPRESENTATIVE_KEY } from "../../supabase/functions/_shared/staffRouting";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (src: string) => stripSql(src).replace(/\s+/g, " ").trim();
const MIGRATION = "20261031010000_menu_trials.sql";
const SQL = read(`supabase/migrations/${MIGRATION}`);

/** 関数の定義（CREATE OR REPLACE から、本体を閉じる $fn$ / $function$ まで） */
const fnDef = (src: string, name: string) => {
  const s = stripSql(src);
  const start = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} の定義が見つからない`).toBeGreaterThan(-1);
  const tag = /AS (\$\w*\$)/.exec(s.slice(start))![1];
  const bodyStart = s.indexOf(tag, start) + tag.length;
  return s.slice(start, s.indexOf(tag, bodyStart) + tag.length);
};
/** 足した部分を取り除く（取り除く前に、足した部分が本当にあることも確かめる） */
const without = (def: string, ...added: string[]) =>
  added.reduce((acc, part) => {
    expect(acc, part).toContain(norm(part));
    return norm(acc.replace(norm(part), " "));
  }, norm(def));

beforeAll(async () => {
  await i18n.changeLanguage("ja");
});
afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.doUnmock("@/integrations/supabase/client");
});

// ── DB ───────────────────────────────────────────────────────────────────────
describe("DB: 列", () => {
  it("booking_menus に体験の設定（オン/オフ・料金・案内）。料金は体験の料金と同じ範囲", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS trial_enabled boolean NOT NULL DEFAULT false/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS trial_price_yen integer/);
    expect(SQL).toContain("CHECK (trial_price_yen IS NULL OR (trial_price_yen >= 0 AND trial_price_yen <= 1000000))");
  });

  it("trial_bookings にメニューと担当。🔴 メニューの外部キーは ON DELETE の動作を付けない（bookings.menu_id と同じ）", () => {
    expect(stripSql(SQL)).toMatch(/ADD COLUMN IF NOT EXISTS menu_id uuid REFERENCES public\.booking_menus\(id\),/);
    expect(stripSql(SQL)).not.toMatch(/REFERENCES public\.booking_menus\(id\)\s+ON DELETE/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS staff_user_id uuid;/);
  });

  it("🔴 ジムを消す処理は、体験をメニューより先に消している（外部キーで止まらない）", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    const last = files.filter((f) => stripSql(read(`supabase/migrations/${f}`)).includes("FUNCTION public.delete_my_gym(")).pop()!;
    const body = stripSql(read(`supabase/migrations/${last}`));
    const trials = body.lastIndexOf("DELETE FROM public.trial_bookings");
    const menus = body.lastIndexOf("DELETE FROM public.booking_menus");
    expect(trials).toBeGreaterThan(-1);
    expect(menus).toBeGreaterThan(trials);
  });

  it("特定のジムの値を書いていない（リポジトリは public。設定は本番で入れる）", () => {
    const s = stripSql(SQL);
    expect(s).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(s).not.toMatch(/\bUPDATE public\./);
    expect(s).not.toMatch(/\bINSERT INTO public\./);
  });
});

describe("DB: 体験にメニューを当てる（apply_trial_menu）", () => {
  const def = () => norm(fnDef(SQL, "apply_trial_menu"));

  it("🔴 trial_bookings の BEFORE トリガーの中でいちばん先に動く名前（担当を入れてから重なりを見る）", () => {
    const all = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => stripSql(read(`supabase/migrations/${f}`))).join("\n");
    const names = [...all.matchAll(/CREATE TRIGGER (\w+)\s+BEFORE [^;]*?ON public\.trial_bookings/g)].map((m) => m[1]);
    expect(names).toContain("prevent_trial_booking_overlap");
    expect(names).toContain("apply_trial_menu");
    for (const n of names.filter((x) => x !== "apply_trial_menu")) {
      expect("apply_trial_menu" < n, `${n} が apply_trial_menu より先に動く`).toBe(true);
    }
    expect(stripSql(SQL)).toMatch(/CREATE TRIGGER apply_trial_menu\s+BEFORE INSERT ON public\.trial_bookings/);
  });

  it("担当はメニューで決まる（送ってきた値は使わない）。メニューの無い体験は担当を持たない", () => {
    expect(def()).toContain("NEW.staff_user_id := v_menu.staff_user_id;");
    expect(def()).toContain("IF NEW.menu_id IS NULL THEN NEW.staff_user_id := NULL; RETURN NEW; END IF;");
  });

  it("別のジムのメニュー・受け付けていないメニュー・ドロップインは断る（GB012）", () => {
    expect(def()).toContain("v_menu.tenant_id IS DISTINCT FROM NEW.tenant_id");
    expect(def()).toContain("COALESCE(NEW.booking_kind, 'trial') <> 'trial'");
    expect(def()).toContain("NOT public.menu_trial_open(NEW.menu_id)");
    expect(def()).toContain("USING ERRCODE = 'GB012'");
  });

  it("開始日より前は断る。シフトは guard_booking_staff_shift（GB002）と同じ数え方", () => {
    expect(def()).toContain("IF v_menu.starts_on IS NOT NULL AND v_jst::date < v_menu.starts_on THEN");
    expect(def()).toContain("AND v_min >= (split_part(s.start_time, ':', 1)::int * 60 + split_part(s.start_time, ':', 2)::int)");
    expect(def()).toContain("AND v_min < (split_part(s.end_time, ':', 1)::int * 60 + split_part(s.end_time, ':', 2)::int)");
    expect(def()).toContain("USING ERRCODE = 'GB002'");
  });

  it("受け付けているか（menu_trial_open）: オン × 体験オン × 担当がジムの現役スタッフ × ジムが営業中", () => {
    const open = norm(fnDef(SQL, "menu_trial_open"));
    for (const part of [
      "m.is_active AND m.trial_enabled AND m.staff_user_id IS NOT NULL",
      "t.status IN ('active', 'trial')",
      "tm.status = 'active' AND tm.role IN ('owner', 'trainer')",
    ]) expect(open).toContain(part);
  });

  it("中で使う関数は直接呼べない", () => {
    for (const sig of ["menu_trial_open(uuid)", "apply_trial_menu()", "guard_trial_menu_reserved()"]) {
      expect(SQL, sig).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
    }
  });
});

describe("🔴 作り直した関数は、足した部分のほかは1文字も変えていない", () => {
  it("専用の時間（guard_trial_menu_reserved）: メニューの体験を先に通す1文だけ", () => {
    const prev = read("supabase/migrations/20261028030000_booking_menus.sql");
    expect(without(fnDef(SQL, "guard_trial_menu_reserved"), "IF NEW.menu_id IS NOT NULL THEN RETURN NEW; END IF;"))
      .toBe(norm(fnDef(prev, "guard_trial_menu_reserved")));
  });

  it("重なり（check_booking_overlap）: 体験の担当を数える・メニューの体験には「体験だけブロックを無視」を効かせない", () => {
    const prev = read("supabase/migrations/20260914010000_trial_ignores_blocked_slots.sql");
    const fresh = norm(fnDef(SQL, "check_booking_overlap"));
    expect(fresh.split("tb.staff_user_id AS staff_user_id").length).toBe(2);
    const reverted = fresh.replace("tb.staff_user_id AS staff_user_id", "NULL::uuid AS staff_user_id");
    expect(without(reverted, "AND (to_jsonb(NEW) ->> 'menu_id') IS NULL")).toBe(norm(fnDef(prev, "check_booking_overlap")));
  });

  it("画面の埋まり枠（get_tenant_booked_slots）: 体験の行の担当を返すだけ。未ログインも呼べるまま", () => {
    const prev = read("supabase/migrations/20261029020000_booking_menu_starts_on.sql");
    const fresh = norm(fnDef(SQL, "get_tenant_booked_slots"));
    expect(fresh.replace("tb.staff_user_id AS staff_user_id", "NULL::uuid AS staff_user_id"))
      .toBe(norm(fnDef(prev, "get_tenant_booked_slots")));
    const s = stripSql(SQL);
    expect(s.indexOf("GRANT EXECUTE ON FUNCTION public.get_tenant_booked_slots(uuid, date, date) TO anon, authenticated;"))
      .toBeGreaterThan(s.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots("));
  });
});

describe("DB: 公開ページの RPC", () => {
  it("未ログイン（公開ページ）とログインした人が呼べる。受け付けていないメニューは何も返さない", () => {
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.get_menu_trial_public(uuid) TO anon, authenticated;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.get_menu_trial_slots(uuid, date, date) TO anon, authenticated;");
    expect(norm(fnDef(SQL, "get_menu_trial_public"))).toContain("AND public.menu_trial_open(m.id)");
    expect(norm(fnDef(SQL, "get_menu_trial_slots"))).toContain("OR NOT public.menu_trial_open(p_menu_id) THEN RETURN;");
  });

  it("担当の user_id を返さない（返すのは「そのメニューの担当の予約か」だけ）", () => {
    const head = (name: string) => {
      const d = fnDef(SQL, name);
      return d.slice(0, d.indexOf("LANGUAGE"));
    };
    expect(head("get_menu_trial_public")).not.toMatch(/staff_user_id|user_id/);
    expect(head("get_menu_trial_slots")).not.toMatch(/staff_user_id|user_id/);
    expect(head("get_menu_trial_slots")).toContain("is_menu_staff boolean");
  });

  it("埋まり枠は get_tenant_booked_slots の体験・予約・時間ブロックと同じ行（専用の時間＝担当つきのブロックだけ返さない）", () => {
    const query = (name: string) => {
      const d = norm(fnDef(SQL, name));
      return d.slice(d.indexOf("RETURN QUERY"));
    };
    const tenant = query("get_tenant_booked_slots");
    const three = tenant.slice(0, tenant.indexOf("UNION ALL SELECT ((d.day::date"));
    const menu = query("get_menu_trial_slots");
    const asTenant = menu
      .slice(0, menu.lastIndexOf("; END;"))
      .replace("COALESCE(tb.staff_user_id = v_staff, false) AS is_menu_staff", "tb.staff_user_id AS staff_user_id")
      .replace("COALESCE(b.staff_user_id = v_staff, false) AS is_menu_staff", "b.staff_user_id")
      .replace("false AS is_menu_staff", "NULL::uuid AS staff_user_id");
    expect(asTenant.trim()).toBe(three.trim());
  });
});

// ── 画面とサーバーの判定が同じ答えを返す ──────────────────────────────────────────
describe("🔴 公開ページ（src/lib）とサーバー（_shared/trialRules.ts）が同じ枠を出す", () => {
  const HOURS: Array<OperatingHours | null> = [
    null,
    { start: "10:00", end: "22:30" },
    {
      start: "10:00", end: "22:30",
      days: { "0": { start: "10:00", end: "22:30" }, "3": { start: "12:00", end: "20:00" }, "5": null },
    },
    { start: "07:30", end: "24:00" },
    { start: "22:00", end: "10:00" },
    { start: "10:00", end: "21:00", days: { "1": { start: "bad", end: "21:00" } } },
  ];
  const SHIFTS = [
    [],
    [{ weekday: 0, start_time: "17:00", end_time: "22:30" }, { weekday: 3, start_time: "16:00", end_time: "22:30" }],
    [{ weekday: 3, start_time: "08:00", end_time: "12:00" }, { weekday: 3, start_time: "15:00", end_time: "23:00" }],
    [{ weekday: 2, start_time: "x", end_time: "y" }],
  ];
  const listed = (day: server.DayMinutes | null, session: number) =>
    Array.from({ length: 24 * 60 + 1 }, (_, m) => m).filter((m) => server.isListedStart(day, m, session));

  it("営業時間（トレーニングの体験）: 曜日ごとの時間も、並ぶ開始時刻も同じ", () => {
    for (const h of HOURS) for (let wd = 0; wd <= 6; wd++) {
      expect(server.resolveDayBusinessMinutes(h, wd)).toEqual(clientDayMinutes(h, wd));
      for (const session of [45, 60, 90]) {
        expect(listed(server.resolveDayBusinessMinutes(h, wd), session), JSON.stringify({ h, wd, session }))
          .toEqual(bookingSlotMinutes(h, session, wd));
      }
    }
  });

  it("担当のシフト（メニューの体験）: シフト ∩ 営業時間も、並ぶ開始時刻も同じ（シフトの無い担当は営業時間どおり）", () => {
    for (const h of HOURS) for (const shifts of SHIFTS) for (let wd = 0; wd <= 6; wd++) {
      const rows = shifts.map((s) => ({ user_id: "s", ...s }));
      expect(server.shiftDayMinutes(h, wd, shifts)).toEqual(staffDayMinutes(h, wd, rows, "s"));
      for (const session of [45, 60]) {
        expect(listed(server.shiftDayMinutes(h, wd, shifts), session), JSON.stringify({ h, shifts, wd, session }))
          .toEqual(staffBookingSlotMinutes(h, session, wd, rows, "s"));
      }
    }
  });

  it("22:30 閉店・60分なら 21:30 開始まで受ける（2026-10-31 まで trial-book は 21:00 開始までしか受けなかった）", () => {
    const day = server.resolveDayBusinessMinutes({ start: "10:00", end: "22:30" }, 3);
    expect(server.isListedStart(day, 21 * 60 + 30, 60)).toBe(true);
    expect(server.isListedStart(day, 21 * 60 + 45, 60)).toBe(false);
    expect(server.isListedStart(day, 21 * 60 + 20, 60)).toBe(false);
    expect(read("supabase/functions/trial-book/index.ts")).not.toMatch(/SLOT_MAX_START|1260/);
  });

  it("何日先まで: 設定の読み方が同じ", () => {
    for (const v of [undefined, null, 0, 1, 10, 365, 366, -1, 3.7, Number.NaN, "10"]) {
      expect(server.normalizeWindowDays(v)).toBe(normalizeBookingWindowDays(v));
    }
  });

  it("開始日が先のメニュー: 画面の最終日の最後の枠をサーバーは受け、その3日後は断る", () => {
    const nowMs = Date.parse("2026-10-31T12:00:00+09:00");
    // 画面は「JST の壁時計を返すローカル時刻」で数える（src/lib/timezone.ts の getJSTNow と同じ形）
    const endKey = menuTrialWindowEndKey("2026-11-25", null, new Date(2026, 9, 31, 12, 0));
    expect(endKey).toBe("2026-12-04");
    const anchor = server.trialWindowAnchorMs(nowMs, "2026-11-25");
    const max = server.trialMaxAheadMs(server.LEGACY_GUEST_WINDOW_DAYS);
    expect(Date.parse(`${endKey}T21:30:00+09:00`) - anchor).toBeLessThanOrEqual(max);
    expect(Date.parse("2026-12-07T10:00:00+09:00") - anchor).toBeGreaterThan(max);
    // 開始日を過ぎたら起点は今（トレーニングの体験と同じ）
    expect(server.trialWindowAnchorMs(Date.parse("2026-11-26T09:00:00+09:00"), "2026-11-25"))
      .toBe(Date.parse("2026-11-26T09:00:00+09:00"));
    expect(server.trialWindowAnchorMs(nowMs, null)).toBe(nowMs);
  });
});

describe("公開ページの判定（src/lib/menuTrial.ts）", () => {
  const HOURS: OperatingHours = { start: "10:00", end: "22:30" };
  const SHIFTS = [
    { weekday: 0, start_time: "17:00", end_time: "22:30" },
    { weekday: 3, start_time: "16:00", end_time: "22:30" },
  ];
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  it("先生のシフトの時間の枠だけ（水 16:00〜21:30・日 17:00〜21:30 開始）。シフトの無い曜日は空", () => {
    const wed = menuTrialSlotMinutes(HOURS, 60, "2026-11-25", SHIFTS).map(hm);
    expect(wed[0]).toBe("16:00");
    expect(wed[wed.length - 1]).toBe("21:30");
    expect(wed).toHaveLength(23);
    const sun = menuTrialSlotMinutes(HOURS, 60, "2026-11-29", SHIFTS).map(hm);
    expect([sun[0], sun[sun.length - 1], sun.length]).toEqual(["17:00", "21:30", 19]);
    expect(menuTrialSlotMinutes(HOURS, 60, "2026-11-26", SHIFTS)).toEqual([]);
    // シフトを1行も持たない担当は営業時間どおり（GB002 と同じ）
    expect(menuTrialSlotMinutes(HOURS, 60, "2026-11-26", [])).toEqual(bookingSlotMinutes(HOURS, 60, 4));
  });

  it("開始日より前の日は選べない（開始日の当日から）", () => {
    expect(isBeforeMenuStart({ startsOn: "2026-11-25" }, "2026-11-24")).toBe(true);
    expect(isBeforeMenuStart({ startsOn: "2026-11-25" }, "2026-11-25")).toBe(false);
    expect(isBeforeMenuStart({ startsOn: null }, "2000-01-01")).toBe(false);
  });

  it("何日先まで: 開始前は開始日から数える（宗本さんが選んだ）。開始後・開始日なしはトレーニングの体験と同じ", () => {
    expect(menuTrialWindowEndKey("2026-11-25", null, new Date(2026, 9, 31, 9, 0))).toBe("2026-12-04");
    expect(menuTrialWindowEndKey("2026-11-25", 30, new Date(2026, 9, 31, 9, 0))).toBe("2026-12-24");
    expect(menuTrialWindowEndKey("2026-11-25", null, new Date(2026, 10, 26, 9, 0))).toBe("2026-12-06");
    expect(menuTrialWindowEndKey(null, null, new Date(2026, 9, 31, 9, 0))).toBe("2026-11-10");
  });

  it("RPC の行を読む（読めない行は「受け付けていない」）", () => {
    const row = {
      menu_id: "m1", tenant_id: "t1", name: " Pilates ", starts_on: "2026-11-25", trial_price_yen: 3000,
      trial_info_title: "  ", trial_info_body: "Body", shifts: [...SHIFTS, { weekday: 1, start_time: "bad", end_time: "x" }],
    };
    expect(parseMenuTrial(row)).toEqual({
      menuId: "m1", tenantId: "t1", name: "Pilates", startsOn: "2026-11-25", priceYen: 3000,
      infoTitle: null, infoBody: "Body", shifts: SHIFTS,
    });
    expect(parseMenuTrial(null)).toBeNull();
    expect(parseMenuTrial({ ...row, name: "" })).toBeNull();
    expect(parseMenuTrial({ ...row, menu_id: 1 })).toBeNull();
    expect(parseMenuTrial({ ...row, trial_price_yen: null, starts_on: "11/25" })).toMatchObject({ priceYen: null, startsOn: null });
  });

  it("リンクは /trial/<ジム>/menu/<メニュー>（App.tsx のルートと同じ形）", () => {
    expect(menuTrialPath("t1", "m1")).toBe("/trial/t1/menu/m1");
    expect(read("src/App.tsx")).toContain('<Route path="/trial/:tenantId/menu/:menuId" element={<TrialBooking />} />');
  });
});

// ── 体験予約ページ ──────────────────────────────────────────────────────────────
describe("体験予約ページ（/trial/:tenantId/menu/:menuId）", () => {
  const TENANT = {
    id: "t1", gym_name: "Gym-A", slot_duration_minutes: 60, booking_buffer_minutes: 15,
    operating_hours: { start: "10:00", end: "22:30" },
    trial_info_title: "TenantTrialTitle", trial_info_body: "TenantTrialBody", trial_price_yen: 5000,
  };
  const MENU_ROW = {
    menu_id: "m1", tenant_id: "t1", name: "MenuX", starts_on: "2099-11-25", trial_price_yen: 3000,
    trial_info_title: "MenuTrialTitle", trial_info_body: "MenuTrialBody",
    shifts: [{ weekday: 3, start_time: "16:00", end_time: "22:30" }],
  };

  const setup = async (path: string, menuRow: Record<string, unknown> | null) => {
    const rpc = vi.fn((name: string) => {
      if (name === "get_tenant_public") return Promise.resolve({ data: [TENANT], error: null });
      if (name === "get_menu_trial_public") return Promise.resolve({ data: menuRow ? [menuRow] : [], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { rpc, functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }) } },
    }));
    const { default: TrialBooking } = await import("@/pages/TrialBooking");
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/trial/:tenantId" element={<TrialBooking />} />
          <Route path="/trial/:tenantId/menu/:menuId" element={<TrialBooking />} />
        </Routes>
      </MemoryRouter>,
    );
    return { rpc };
  };

  it("メニューの名前・メニューの案内・メニューの料金を出す。🔴 トレーニングの体験の案内・料金は出さない", async () => {
    const { rpc } = await setup("/trial/t1/menu/m1", MENU_ROW);
    expect(await screen.findByText(i18n.t("menuTrial.headerTitle", { name: "MenuX" }))).toBeTruthy();
    expect(screen.getByText("MenuTrialTitle")).toBeTruthy();
    expect(screen.getByText("MenuTrialBody")).toBeTruthy();
    expect(screen.queryByText("TenantTrialTitle")).toBeNull();
    await waitFor(() => expect(screen.getByText(formatYen(3000))).toBeTruthy());
    expect(screen.queryByText(formatYen(5000))).toBeNull();
    // 開始日がまだ先なら、いつから予約できるかを出す
    expect(screen.getByTestId("menu-trial-starts-on").textContent)
      .toBe(i18n.t("menuTrial.startsOnNotice", { name: "MenuX", date: menuStartLabel("2099-11-25") }));
    // 埋まり枠はメニューの RPC で読む（担当つきのブロック＝先生の時間を塞ぐ RPC は呼ばない）
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_menu_trial_slots", expect.objectContaining({ p_menu_id: "m1" })));
    expect(rpc.mock.calls.some(([n]) => n === "get_tenant_booked_slots")).toBe(false);
  });

  it("案内が空のメニューは案内カードを出さない（トレーニングの体験の既定文も出さない）", async () => {
    await setup("/trial/t1/menu/m1", { ...MENU_ROW, trial_info_title: null, trial_info_body: null });
    expect(await screen.findByText(i18n.t("menuTrial.headerTitle", { name: "MenuX" }))).toBeTruthy();
    expect(screen.queryByText(i18n.t("trialBooking.infoTitle"))).toBeNull();
    expect(screen.queryByText("TenantTrialTitle")).toBeNull();
  });

  it("受け付けていないメニューは「受け付けていません」だけ（入力欄を出さない）", async () => {
    await setup("/trial/t1/menu/m1", null);
    expect(await screen.findByText(i18n.t("menuTrial.unavailableTitle"))).toBeTruthy();
    expect(screen.queryByLabelText(new RegExp(i18n.t("trialBooking.labelName")))).toBeNull();
  });

  it("URL のジムと違うジムのメニューは出さない", async () => {
    await setup("/trial/t1/menu/m1", { ...MENU_ROW, tenant_id: "other" });
    expect(await screen.findByText(i18n.t("menuTrial.unavailableTitle"))).toBeTruthy();
  });

  it("ふつうの体験予約ページは今まで通り（メニューを読まない・トレーニングの体験の案内と料金）", async () => {
    const { rpc } = await setup("/trial/t1", MENU_ROW);
    expect(await screen.findByText("TenantTrialTitle")).toBeTruthy();
    expect(screen.getByText(i18n.t("trialBooking.headerTitle"))).toBeTruthy();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("get_tenant_booked_slots", expect.anything()));
    expect(rpc.mock.calls.some(([n]) => String(n).startsWith("get_menu_trial"))).toBe(false);
  });

  it("送るときにメニューを付ける。メニューの体験には「体験だけブロックを無視」を効かせない。担当の予約と重なる枠は出さない", () => {
    const src = read("src/pages/TrialBooking.tsx");
    expect(src).toContain("...(menu ? { menu_id: menu.menuId } : {}),");
    expect(src).toContain("const ignoreBlocks = !menuId && tenant?.trial_ignores_blocked_slots === true;");
    expect(src).toContain("if (overlapping.some((b) => b.isMenuStaff)) return true;");
  });
});

// ── サーバー・通知 ─────────────────────────────────────────────────────────────
describe("trial-book・通知", () => {
  const BOOK = read("supabase/functions/trial-book/index.ts");

  it("メニューの体験はメニューの担当のシフトで、トレーニングの体験は営業時間で、開始時刻を見る", () => {
    expect(BOOK).toContain("const day = menu ? shiftDayMinutes(hours, weekday, shifts) : resolveDayBusinessMinutes(hours, weekday);");
    expect(BOOK).toContain("if (!isListedStart(day, startMin, sessionMinutes)) {");
    expect(BOOK).toContain("const anchorMs = trialWindowAnchorMs(Date.now(), menu?.starts_on);");
  });

  it("担当は送らない（DB がメニューから入れる）。メニューの料金で書く。断りの理由を分ける", () => {
    expect(BOOK).toContain("...(menu ? { menu_id: menu.id } : {}),");
    expect(BOOK).not.toMatch(/staff_user_id:\s*menu/);
    expect(BOOK).toContain("trialPriceYen: menu ? menu.trial_price_yen : trialPriceYen,");
    expect(BOOK).toContain('if (code === "GB012") {');
    expect(BOOK).toContain('if (code === "GB001" || code === "GB002" || msg.includes("この時間帯") || /overlap/i.test(msg)) {');
  });

  it("🔴 先生へのメールは代表のキーと別（送り直しの対象にならない）", () => {
    expect(BOOK).toContain("idempotencyKey: `trial-notify-${notifyKey}-staff`,");
    expect(BOOK).toContain("if (menu && menu.staff_user_id !== trainerId) {");
    const uuid = "9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
    expect(REPRESENTATIVE_KEY.test(`trial-notify-2026-11-25T17:00:00+09:00-a@b.jp-staff`)).toBe(false);
    expect(REPRESENTATIVE_KEY.test(`trial-cancel-${uuid}-${uuid}`)).toBe(false);
    expect(read("src/lib/staffNotify.ts")).toContain("idempotencyKey: `trial-cancel-${trialId}-${userId}`,");
  });

  it("プッシュはメニューの体験の担当にも送る。列がまだ無い DB でも今まで通り送れる（\"*\" で読む）", () => {
    const push = read("supabase/functions/send-push-notification/index.ts");
    expect(push).toContain('.from("trial_bookings")\n        .select("*")');
    expect(push).toContain("if (trialStaffId && !user_ids.includes(trialStaffId)) {");
  });

  it("確認メール・前日リマインドはメニューの名前で呼ぶ（呼び方は1か所）", () => {
    for (const f of ["trial-booking-confirmation.tsx", "trial-booking-reminder.tsx"]) {
      const src = read(`supabase/functions/_shared/transactional-email-templates/${f}`);
      expect(src, f).toContain("const trialName = trialNameOf(menuName)");
      expect(src, f).toContain("trialNameOf(data?.menuName as string | null | undefined)");
    }
    expect(read("supabase/functions/send-trial-reminders/index.ts")).toContain("menuName: menu?.name ?? null,");
    expect(server.trialName("Pilates")).toContain("Pilates");
    expect(server.trialName(null)).not.toContain("null");
    expect(server.trialContentValue(null)).toContain(server.trialName(null));
    expect(server.trialBookingLabel("Pilates")).toContain("Pilates");
    expect(server.trialBookingLabel(" ")).toBe(server.trialBookingLabel(null));
  });

  it("予定表: 体験の行にメニューと担当を付ける。店が体験を取り消したら担当（とオーナー）に知らせる", () => {
    const hooks = read("src/hooks/useBookings.ts");
    expect(hooks).toContain("menuId: t.menu_id ?? null,");
    expect(hooks).toContain("staff_user_id: t.staff_user_id ?? null,");
    const schedule = read("src/components/trainer/TrainerSchedule.tsx");
    // 担当の列は名指ししない（"*"。列が無い DB でカレンダーの削除まで止めないため・staffAssignment.test.ts と同じ決まり）
    expect(schedule).toContain('.select("*") // 列を名指ししない（担当の列が無い DB でもカレンダーの削除を止めない）');
    expect(schedule).toContain("if (!res.error) void notifyTrialCancelled({");
  });
});

describe("店が体験を取り消したときの知らせ（notifyTrialCancelled）", () => {
  const setup = async (actor: string) => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: {
        auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: actor } } } }) },
        functions: { invoke },
      },
    }));
    vi.doMock("@/lib/tenantHelper", () => ({
      fetchMyTenantStaffRoster: () => Promise.resolve({ ids: ["owner"], owners: ["owner"], names: {} }),
      fetchMyTenantId: () => Promise.resolve("t1"),
    }));
    const { notifyTrialCancelled } = await import("@/lib/staffNotify");
    return { invoke, notifyTrialCancelled };
  };
  const params = {
    trialId: "tr1", guestName: "Guest", date: "2026-11-25", startTime: "17:00", endTime: "18:00", label: "Label",
  };
  afterEach(() => vi.doUnmock("@/lib/tenantHelper"));

  it("オーナーがメニューの体験を取り消した → 担当の先生にプッシュとメール（オーナー自身には送らない）", async () => {
    const { invoke, notifyTrialCancelled } = await setup("owner");
    await notifyTrialCancelled({ ...params, staffId: "teacher" });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    const [pushCall, mailCall] = invoke.mock.calls;
    expect(pushCall[0]).toBe("send-push-notification");
    expect(pushCall[1].body.user_ids).toEqual(["teacher"]);
    expect(mailCall[0]).toBe("send-transactional-email");
    expect(mailCall[1].body).toMatchObject({
      templateName: "booking-cancellation", recipientEmail: "_resolve_trainer_", tenantId: "t1",
      idempotencyKey: "trial-cancel-tr1-teacher",
      templateData: { trainerUserId: "teacher", isTrial: true, cancelledByTrainer: true, planName: "Label" },
    });
  });

  it("オーナーがトレーニングの体験（担当なし）を取り消した → 誰にも送らない（今まで通り）", async () => {
    const { invoke, notifyTrialCancelled } = await setup("owner");
    await notifyTrialCancelled({ ...params, staffId: null });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("先生が自分の体験を取り消した → オーナーに知らせる（本人には送らない）", async () => {
    const { invoke, notifyTrialCancelled } = await setup("teacher");
    await notifyTrialCancelled({ ...params, staffId: "teacher" });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[0][1].body.user_ids).toEqual(["owner"]);
    expect(invoke.mock.calls[1][1].body.templateData.trainerUserId).toBe("owner");
  });
});

describe("設定画面", () => {
  it("担当のいるメニューの行だけに体験予約ページの設定を出す", () => {
    expect(read("src/components/trainer/TrainerBookingMenus.tsx"))
      .toContain("{m.staff_user_id && <TrainerMenuTrialSettings menu={m} tenantId={tenant.id} />}");
  });

  it("リンクは本番の Web のドメイン（getWebOrigin）で作る（ネイティブの capacitor:// を送らない）", () => {
    expect(read("src/components/trainer/TrainerMenuTrialSettings.tsx"))
      .toContain("const link = `${getWebOrigin()}${menuTrialPath(tenantId, menu.id)}`;");
  });

  it("5言語に同じ文言のキーがある", () => {
    const keys = (l: string) => {
      const j = JSON.parse(read(`src/locales/${l}.json`));
      return [
        ...Object.keys(j.menuTrial ?? {}).map((k) => `menuTrial.${k}`),
        ...Object.keys(j.bookingMenus ?? {}).filter((k) => k.startsWith("trial")).map((k) => `bookingMenus.${k}`),
      ].sort();
    };
    const ja = keys("ja");
    expect(ja.length).toBeGreaterThan(30);
    for (const l of ["en", "ko", "zh-CN", "zh-TW"]) expect(keys(l), l).toEqual(ja);
  });
});
