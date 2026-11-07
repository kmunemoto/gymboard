import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { normalizeTenantRow, TENANT_DEFAULT_FALSE_COLS, TENANT_OPTIONAL_COL_GROUPS } from "@/lib/tenantColumns";
import { isAppOutdatedError, KNOWN_GUARD_CODES } from "@/lib/bookingErrors";
import { moveBookingLaterToday } from "@/hooks/bookingLaterToday";
import SameDayRulesCard from "@/components/trainer/SameDayRulesCard";
import SameDayNotice from "@/components/booking/SameDayNotice";

// 当日の予約を、同じ日の後ろの時間へ、お客様がアプリから変更できる（ジムごと ON/OFF・2026-11-07）。
//
// 宗本さん「当日予約してるお客様が、当日の後ろ限定で、当日に予約取ってる予約よりも、後ろの時間で
//          日時変更ができる設定を作ってほしい」。
//
// 決まり（どの変更が消化になるか）は sameDayReschedule.test.ts。ここは、
//   - DB: 設定の列・動かす関数（move_booking_later_today）・当日削除の見張りに足した例外
//   - アプリ: 動かす前後の仕事（Googleカレンダー・店への通知）の順番
//   - 設定のスイッチ・今日の案内の部品
// を見る。

// ── モック（アプリの「動かす」処理・設定のスイッチ） ─────────────────────────
const calls: string[] = [];
const rpcResult = { current: { data: "new-id" as string | null, error: null as unknown } };
const oldRow = {
  id: "old-id", user_id: "cust-1", booking_date: "2026-11-07T08:00:00+00:00", booking_type: "月4回",
  google_event_id: "evt-1" as string | null, staff_user_id: "staff-1",
};
const tenantRef = { current: { id: "t1", same_day_cancel_penalty_enabled: true, same_day_later_reschedule_enabled: false } as Record<string, unknown> | null };
const tenantUpdates: Record<string, unknown>[] = [];
const refetchTenant = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            calls.push(`select:${table}`);
            return Promise.resolve({ data: oldRow, error: null });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => {
        tenantUpdates.push(values);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
    functions: {
      invoke: (name: string, opts: { body: { action: string } }) => {
        calls.push(`invoke:${name}:${opts.body.action}`);
        return Promise.resolve({ data: null, error: null });
      },
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}:${JSON.stringify(args)}`);
      return Promise.resolve(rpcResult.current);
    },
  },
}));
vi.mock("@/lib/calendarResync", () => ({
  resyncCalendarCreate: (id: string) => {
    calls.push(`resync:${id}`);
    return Promise.resolve();
  },
}));
vi.mock("@/hooks/useBookings", () => ({
  sendRescheduleToTrainer: (...args: unknown[]) => {
    calls.push(`notify:${JSON.stringify(args)}`);
    return Promise.resolve();
  },
}));
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: tenantRef.current, refetch: refetchTenant }),
}));

beforeEach(() => {
  calls.length = 0;
  tenantUpdates.length = 0;
  rpcResult.current = { data: "new-id", error: null };
  oldRow.google_event_id = "evt-1";
  refetchTenant.mockClear();
  cleanup();
});

// ── DB ───────────────────────────────────────────────────────────────────
const MIGRATION = "supabase/migrations/20261107010000_same_day_later_reschedule.sql";
const RAW = readFileSync(MIGRATION, "utf8");
const SQL = RAW.replace(/--[^\n]*/g, "");
const fnBody = (name: string) => {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  return SQL.slice(start, SQL.indexOf("$function$;", start));
};

describe("DB: 設定の列", () => {
  it("既定は OFF（今まで通り）。特定のジムの値をリポジトリに書かない", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS same_day_later_reschedule_enabled boolean NOT NULL DEFAULT false/);
    expect(RAW).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });
});

describe("DB: move_booking_later_today（当日の予約を、同じ日の後ろへ動かす）", () => {
  const body = fnBody("move_booking_later_today");

  it("🔴 SECURITY INVOKER（お客様の権限のまま。RLS と予約の見張りはアプリの日時の変更と同じ）", () => {
    expect(body).toContain("SECURITY INVOKER");
    expect(body).not.toContain("SECURITY DEFINER");
    expect(body).toContain("SET search_path TO 'public'");
  });

  it("🔴 動かせるのは: 未ログインでない・自分の予約・設定が ON・予約済み（営業時間外の印なし）・当日・始まる前・同じ日のもっと後ろ", () => {
    expect(body).toMatch(/IF v_uid IS NULL THEN\s+RAISE EXCEPTION '[^']+' USING ERRCODE = '42501';/);
    expect(body).toMatch(/IF NOT FOUND OR v_old\.user_id IS DISTINCT FROM v_uid THEN\s+RAISE EXCEPTION '[^']+' USING ERRCODE = 'GB013';/);
    expect(body).toMatch(/SELECT t\.same_day_later_reschedule_enabled INTO v_enabled\s+FROM public\.tenants t WHERE t\.id = v_old\.tenant_id;\s+IF NOT COALESCE\(v_enabled, false\) THEN/);
    expect(body).toContain("IF v_old.status IS DISTINCT FROM '予約済み' OR COALESCE(v_old.outside_hours, false) THEN");
    expect(body).toContain("IF (v_old.booking_date AT TIME ZONE 'Asia/Tokyo')::date <> v_today THEN");
    expect(body).toContain("IF now() >= v_old.booking_date THEN");
    expect(body).toMatch(/IF p_new_booking_date IS NULL\s+OR \(p_new_booking_date AT TIME ZONE 'Asia\/Tokyo'\)::date <> v_today\s+OR p_new_booking_date <= v_old\.booking_date THEN/);
    expect(body).toContain("v_today   date := (now() AT TIME ZONE 'Asia/Tokyo')::date;");
  });

  it("🔴 確かめてから消す。印は消す直前に立てて直後に下ろす。消せなかったら（同時に2回など）止める", () => {
    const lastCheck = body.indexOf("OR p_new_booking_date <= v_old.booking_date THEN");
    const setFlag = body.indexOf("PERFORM set_config('app.same_day_later_move', v_old.id::text, true);");
    const del = body.indexOf("DELETE FROM public.bookings WHERE id = v_old.id;");
    const clear = body.indexOf("PERFORM set_config('app.same_day_later_move', '', true);");
    const ins = body.indexOf("INSERT INTO public.bookings");
    expect(lastCheck).toBeGreaterThan(0);
    expect(lastCheck).toBeLessThan(setFlag);
    expect(setFlag).toBeLessThan(del);
    expect(del).toBeLessThan(clear);
    expect(clear).toBeLessThan(ins);
    expect(body).toMatch(/GET DIAGNOSTICS v_deleted = ROW_COUNT;[\s\S]*IF v_deleted <> 1 THEN\s+[\s\S]*?USING ERRCODE = 'GB013';/);
  });

  it("作り直す中身はアプリの日時の変更と同じ（新しい予約の通知は出さない・担当/メニュー/オプション/回答/メモを引き継ぐ）", () => {
    const ins = body.slice(body.indexOf("INSERT INTO public.bookings"), body.indexOf("RETURNING id INTO v_new_id;"));
    expect(ins).toContain("'reschedule'");
    expect(ins).toContain("'gymboard'"); // salute_sync を引き継がない（見張りを素通りする印）
    expect(ins).toContain("'予約済み'");
    for (const col of ["staff_user_id", "custom_answers", "option_minutes", "booking_options", "menu_id", "trainer_note", "booking_type"]) {
      expect(ins, col).toContain(col);
    }
    // 予定の ID・営業時間外の印は引き継がない（予定はアプリが作り直す。印は店だけが付けられる）
    expect(ins).not.toContain("google_event_id");
    expect(ins).not.toContain("outside_hours");
    expect(ins).not.toContain("v_old.source");
  });

  it("🔴 お客様（authenticated）だけが呼べる。anon には渡さない", () => {
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.move_booking_later_today(uuid, timestamptz) FROM PUBLIC, anon;");
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION public.move_booking_later_today(uuid, timestamptz) TO authenticated;");
    expect(SQL).not.toMatch(/TO anon/);
  });

  it("GB013 はアプリが知っている番号（「アプリが古い」と出さない）", () => {
    expect(KNOWN_GUARD_CODES as readonly string[]).toContain("GB013");
    expect(isAppOutdatedError({ code: "GB013" })).toBe(false);
  });
});

describe("DB: 当日削除の見張り（enforce_booking_same_day_delete）の例外", () => {
  const body = fnBody("enforce_booking_same_day_delete");
  const bypass = "IF COALESCE(current_setting('app.same_day_later_move', true), '') = OLD.id::text THEN\n    RETURN OLD;\n  END IF;";

  it("🔴 例外は「その予約の ID の印」があるときだけ", () => {
    expect(body).toContain(bypass);
    expect(body.split("app.same_day_later_move").length - 1).toBe(1);
  });

  it("🔴 消化扱い・過去の予約は印があっても消せない（例外はその2つを見たあと、消化の設定を読む直前）", () => {
    const at = body.indexOf(bypass);
    expect(body.indexOf("IF OLD.status = '同日キャンセル済み' THEN")).toBeLessThan(at);
    expect(body.indexOf("RAISE EXCEPTION '過去の予約は削除できません。'")).toBeLessThan(at);
    expect(at).toBeLessThan(body.indexOf("SELECT t.same_day_cancel_penalty_enabled INTO v_penalty"));
  });

  it("スタッフの判定・SECURITY DEFINER は今まで通り", () => {
    expect(body).toContain("SECURITY DEFINER");
    expect(body).toContain("IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN");
  });

  it("🔴 印を立てるのは move_booking_later_today だけ（ほかの migration・関数が立てていない）", () => {
    const setters: string[] = [];
    for (const f of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(`supabase/migrations/${f}`, "utf8").replace(/--[^\n]*/g, "");
      for (const m of sql.matchAll(/set_config\('app\.same_day_later_move'/g)) setters.push(`${f}@${m.index}`);
    }
    expect(setters).toHaveLength(2); // 立てる・下ろす
    expect(setters.every((s) => s.startsWith("20261107010000_same_day_later_reschedule.sql@"))).toBe(true);
    const moveStart = SQL.indexOf("CREATE OR REPLACE FUNCTION public.move_booking_later_today(");
    for (const m of SQL.matchAll(/set_config\('app\.same_day_later_move'/g)) {
      expect(m.index!).toBeGreaterThan(moveStart);
    }
  });
});

// ── アプリ: 動かす前後の仕事 ─────────────────────────────────────────────
describe("アプリ: moveBookingLaterToday", () => {
  it("🔴 予定を消す（予約の行があるうちに）→ DB で動かす → 新しい予定を作る → 店へ「予約日時の変更」（消化ではない）", async () => {
    const res = await moveBookingLaterToday("old-id", "2026-11-07", "19:00");
    expect(res).toEqual({ data: { id: "new-id" }, error: null });
    expect(calls[0]).toBe("select:bookings");
    expect(calls[1]).toBe("invoke:google-calendar-sync:delete");
    expect(calls[2]).toBe(`rpc:move_booking_later_today:${JSON.stringify({ p_booking_id: "old-id", p_new_booking_date: "2026-11-07T19:00:00+09:00" })}`);
    await waitFor(() => expect(calls).toContain("resync:new-id"));
    expect(calls).toContain(`notify:${JSON.stringify(["cust-1", oldRow.booking_date, "2026-11-07", "19:00", "月4回", false, "staff-1"])}`);
  });

  it("🔴 断られたら、消した予定だけ戻して終わる（通知しない・新しい予定も作らない）", async () => {
    rpcResult.current = { data: null, error: { code: "GB013", message: "開始時刻を過ぎた予約は変更できません" } };
    const res = await moveBookingLaterToday("old-id", "2026-11-07", "19:00");
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ code: "GB013", message: "開始時刻を過ぎた予約は変更できません" });
    expect(res.restoreFailed).toBeUndefined();
    expect(calls).toContain("resync:old-id");
    expect(calls.some((c) => c.startsWith("notify:"))).toBe(false);
    expect(calls).not.toContain("resync:new-id");
  });

  it("予定が無い予約は、消す・戻すをしない", async () => {
    oldRow.google_event_id = null;
    rpcResult.current = { data: null, error: { code: "P0001", message: "満枠" } };
    await moveBookingLaterToday("old-id", "2026-11-07", "19:00");
    expect(calls.some((c) => c.startsWith("invoke:google-calendar-sync:delete"))).toBe(false);
    expect(calls).not.toContain("resync:old-id");
  });
});

// ── 設定のスイッチ ───────────────────────────────────────────────────────
describe("設定: SameDayRulesCard（予約ポリシー）", () => {
  it("2つのスイッチが並び、それぞれ自分の列だけを保存して再取得する", async () => {
    tenantRef.current = { id: "t1", same_day_cancel_penalty_enabled: true, same_day_later_reschedule_enabled: false };
    render(<SameDayRulesCard />);
    expect(screen.getByText(i18n.t("settings.trainer.sameDayPenaltyTitle"))).toBeInTheDocument();
    const later = screen.getByRole("switch", { name: i18n.t("settings.trainer.sameDayLaterMoveTitle") });
    expect(later).toHaveAttribute("aria-checked", "false");
    fireEvent.click(later);
    await waitFor(() => expect(tenantUpdates).toEqual([{ same_day_later_reschedule_enabled: true }]));
    await waitFor(() => expect(refetchTenant).toHaveBeenCalled());

    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(2);
    expect(switches[0]).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(switches[0]).not.toBeDisabled());
    fireEvent.click(switches[0]);
    await waitFor(() => expect(tenantUpdates[1]).toEqual({ same_day_cancel_penalty_enabled: false }));
  });

  it("列が読めない環境（undefined）ではオフに見える", () => {
    tenantRef.current = { id: "t1", same_day_cancel_penalty_enabled: false };
    render(<SameDayRulesCard />);
    expect(screen.getByRole("switch", { name: i18n.t("settings.trainer.sameDayLaterMoveTitle") })).toHaveAttribute("aria-checked", "false");
  });

  it("ジム設定の予約ポリシーに置いてある（元のスイッチはこちらへ移した）", () => {
    const settings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
    expect(settings).toContain("<SameDayRulesCard />");
    expect(settings).not.toContain("handleToggleSameDayPenalty");
    expect(settings).not.toContain("same_day_cancel_penalty_enabled");
  });

  it("テナントの列: 後から足した列に入っていて、読めないときは OFF", () => {
    expect(TENANT_OPTIONAL_COL_GROUPS).toContain("same_day_later_reschedule_enabled");
    expect(TENANT_DEFAULT_FALSE_COLS).toContain("same_day_later_reschedule_enabled");
    expect(normalizeTenantRow({}).same_day_later_reschedule_enabled).toBe(false);
    expect(normalizeTenantRow({ same_day_later_reschedule_enabled: true }).same_day_later_reschedule_enabled).toBe(true);
  });
});

// ── 今日の案内 ───────────────────────────────────────────────────────────
describe("今日の案内: SameDayNotice", () => {
  it("後ろへ動かせるときは、その案内だけ（「見るだけ」の案内・電話のボタンは出さない）", () => {
    render(<SameDayNotice laterToday viewOnly phone="000" lineUrl="https://line.me/x" />);
    expect(screen.getByTestId("later-today-hint")).toHaveTextContent(i18n.t("booking.laterTodayHint"));
    expect(screen.queryByText(i18n.t("booking.sameDayViewOnlyNotice"))).toBeNull();
    expect(screen.queryByText(i18n.t("booking.callGym"))).toBeNull();
  });

  it("見るだけの日は、今まで通りの案内と電話・LINE・チャット", () => {
    const onOpenChat = vi.fn();
    render(<SameDayNotice laterToday={false} viewOnly phone="0751234567" lineUrl="https://line.me/x" onOpenChat={onOpenChat} />);
    expect(screen.getByText(i18n.t("booking.sameDayViewOnlyNotice"))).toBeInTheDocument();
    expect(screen.getByText(i18n.t("booking.callGym")).closest("a")).toHaveAttribute("href", "tel:0751234567");
    expect(screen.getByText(i18n.t("common.lineContact"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(i18n.t("booking.chatWithGym")));
    expect(onOpenChat).toHaveBeenCalled();
  });

  it("どちらでもなければ何も出さない", () => {
    const { container } = render(<SameDayNotice laterToday={false} viewOnly={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
