/**
 * 週に何日かだけ、会員の1日の上限を増やす（tenants.weekly_peak_limit / weekly_peak_days・2026-10-22）。
 *
 * 宗本さん「1週間に受ける予約の数を2つ増やします。基本一日5枠までにして、週に2日5枠が
 * 埋まったら他の曜日は枠の上限を自動で4枠までにする。体験予約はこれに影響されません」。
 * 確認: 1. 週は月曜〜日曜 ／ 2. 会員5人の日も合計の上限（体験込み）はそのまま。
 *
 * 🔴 壊しやすいもの:
 *   1. 範囲の外の日（範囲の前の月曜など）を数え忘れる → 3日目の5人目が通る
 *   2. 週の区切りが日曜始まりになる
 *   3. その日自身を「多い日」に数える → 5人目を取った日が自分で枠を減らす
 *   4. 上限を外した日を多い日に数える
 *   5. 画面（予定表の n/◯人）と DB で計算がずれる
 *   6. 同時に別の日の5人目が来て、両方通る（週のロック）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import { isoWeekKeys, memberLimitOn, weeklyPeakEnabled, type WeeklyPeakSettings } from "@/lib/weeklyPeak";
import { TENANT_VALUE_DEFAULTS, normalizeTenantRow, tenantOptionalColumnNames } from "@/lib/tenantColumns";

const updates: unknown[] = [];
const tenantRef = { current: null as Record<string, unknown> | null };
const toastError = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      update: (v: unknown) => {
        updates.push(v);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  },
}));
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ tenant: tenantRef.current, refetch: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));
vi.mock("@/hooks/useBookingClosedDays", () => ({
  useBookingClosedDays: () => ({ closedDays: [], refetch: vi.fn() }),
  useCloseDay: () => ({ close: vi.fn(), reopen: vi.fn(), saving: false }),
  useUncappedDays: () => ({ uncappedDays: uncappedRef.current, refetch: vi.fn() }),
  useUncapDay: () => ({ uncap: vi.fn(), recap: vi.fn(), saving: false }),
}));
const uncappedRef = { current: [] as string[] };

beforeEach(() => {
  updates.length = 0;
  toastError.mockClear();
  uncappedRef.current = [];
  tenantRef.current = { id: "t1", daily_booking_limit: 4, daily_total_limit: 5, weekly_peak_days: 2, weekly_peak_limit: 5 };
});
afterEach(cleanup);

// 2027-02-01 は月曜
const S: WeeklyPeakSettings = { dailyLimit: 4, peakLimit: 5, peakDays: 2 };
const counts = (m: Record<string, number>) => (k: string) => m[k] ?? 0;
const none = () => false;

describe("週の区切り（月曜〜日曜）", () => {
  it("月曜始まりの7日。日曜はその前の月曜の週", () => {
    expect(isoWeekKeys("2027-02-03")).toEqual([
      "2027-02-01", "2027-02-02", "2027-02-03", "2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07",
    ]);
    expect(isoWeekKeys("2027-02-07")[0]).toBe("2027-02-01");
    expect(isoWeekKeys("2027-02-08")[0]).toBe("2027-02-08");
  });

  it("月・年をまたぐ週", () => {
    expect(isoWeekKeys("2027-01-01")).toEqual([
      "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
    ]);
  });
});

describe("その日の会員の上限", () => {
  it("多い日がまだ無い週は、どの日も5人", () => {
    for (const k of isoWeekKeys("2027-02-01")) expect(memberLimitOn(k, S, counts({}), none)).toBe(5);
  });

  it("🔴 宗本さんの例: 月・火に5人 → 水〜日は4人、月・火は5人のまま", () => {
    const c = counts({ "2027-02-01": 5, "2027-02-02": 5 });
    expect(memberLimitOn("2027-02-01", S, c, none)).toBe(5);
    expect(memberLimitOn("2027-02-02", S, c, none)).toBe(5);
    for (const k of ["2027-02-03", "2027-02-04", "2027-02-05", "2027-02-06", "2027-02-07"]) {
      expect(memberLimitOn(k, S, c, none), k).toBe(4);
    }
  });

  it("🔴 その日自身は数えない（5人目を取った日が自分で枠を減らさない）", () => {
    const c = counts({ "2027-02-01": 5 });
    expect(memberLimitOn("2027-02-01", S, c, none)).toBe(5);
    // 週に1日の設定でも、5人入ったその日は5人のまま（自分を数えると4に下がって、5人目が「超過」に見える）
    expect(memberLimitOn("2027-02-01", { ...S, peakDays: 1 }, c, none)).toBe(5);
  });

  it("キャンセルで5人の日が減れば、ほかの日がまた5人まで", () => {
    const c = counts({ "2027-02-01": 5, "2027-02-02": 4 });
    expect(memberLimitOn("2027-02-03", S, c, none)).toBe(5);
  });

  it("🔴 週が変われば数え直す（前の週の多い日は関係ない）", () => {
    const c = counts({ "2027-02-06": 5, "2027-02-07": 5 });
    expect(memberLimitOn("2027-02-05", S, c, none)).toBe(4);
    expect(memberLimitOn("2027-02-08", S, c, none)).toBe(5);
  });

  it("🔴 上限を外した日は上限なし、多い日の数にも入れない", () => {
    const c = counts({ "2027-02-01": 7, "2027-02-02": 5 });
    const uncapped = (k: string) => k === "2027-02-01";
    expect(memberLimitOn("2027-02-01", S, c, uncapped)).toBeNull();
    expect(memberLimitOn("2027-02-03", S, c, uncapped)).toBe(5);
  });

  it("5人を超えた日（店の代理予約など）も多い日として数える", () => {
    const c = counts({ "2027-02-01": 6, "2027-02-02": 5 });
    expect(memberLimitOn("2027-02-03", S, c, none)).toBe(4);
  });

  it("設定が無い・そろっていない・会員の上限以下なら今まで通り", () => {
    const c = counts({ "2027-02-01": 5, "2027-02-02": 5 });
    expect(memberLimitOn("2027-02-03", { dailyLimit: 4, peakLimit: null, peakDays: null }, c, none)).toBe(4);
    expect(memberLimitOn("2027-02-03", { dailyLimit: 4, peakLimit: 5, peakDays: null }, c, none)).toBe(4);
    expect(memberLimitOn("2027-02-01", { dailyLimit: 4, peakLimit: 4, peakDays: 2 }, counts({}), none)).toBe(4);
    expect(memberLimitOn("2027-02-01", { dailyLimit: null, peakLimit: 5, peakDays: 2 }, counts({}), none)).toBeNull();
    expect(weeklyPeakEnabled({ dailyLimit: 4, peakLimit: 5, peakDays: 2 })).toBe(true);
    expect(weeklyPeakEnabled({ dailyLimit: 4, peakLimit: 4, peakDays: 2 })).toBe(false);
  });

  it("週に1日・3日の設定でも同じ考え方", () => {
    const c = counts({ "2027-02-01": 5 });
    expect(memberLimitOn("2027-02-02", { ...S, peakDays: 1 }, c, none)).toBe(4);
    expect(memberLimitOn("2027-02-02", { ...S, peakDays: 3 }, counts({ "2027-02-01": 5, "2027-02-03": 5 }), none)).toBe(5);
  });
});

describe("予定表の n/◯人（useDayReception）", () => {
  const booking = (date: string, extra: Record<string, unknown> = {}) => ({ date, status: "予約済み", user_id: "u", ...extra });

  it("🔴 日ごとの上限を返す（月・火に5人 → 水は4）。体験は数えない・営業時間外は数える", async () => {
    const { useDayReception } = await import("@/hooks/useDayReception");
    const bookings = [
      ...Array.from({ length: 5 }, () => booking("2027-02-01")),
      ...Array.from({ length: 3 }, () => booking("2027-02-02")),
      booking("2027-02-02", { user_id: "trial-guest" }),
      booking("2027-02-02", { outsideHours: true }), // 2026-10-23〜 時間外も1枠として数える
    ];
    const { result, rerender } = renderHook(
      ({ list }) => useDayReception("2027-02-01", "2027-02-07", list, 4, { limit: 5, days: 2 }),
      { initialProps: { list: bookings } },
    );
    // 火は会員4人（通常3＋時間外1。体験は数えない）→ 多い日は月だけ → 水も5
    expect(result.current.dailyLimitOn("2027-02-03")).toBe(5);
    rerender({ list: [...bookings, booking("2027-02-02")] });
    expect(result.current.dailyLimitOn("2027-02-03")).toBe(4);
    expect(result.current.dailyLimitOn("2027-02-01")).toBe(5);
    expect(result.current.dailyLimit).toBe(4);
  });

  it("設定が無ければ今まで通り（毎日おなじ上限）", async () => {
    const { useDayReception } = await import("@/hooks/useDayReception");
    const { result } = renderHook(() => useDayReception("2027-02-01", "2027-02-07", [], 4));
    expect(result.current.dailyLimitOn("2027-02-03")).toBe(4);
  });

  it("予定表の札に日ごとの上限を渡している", () => {
    const schedule = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    expect(schedule).toContain("dailyLimit={dayReception.dailyLimitOn(d)}");
    expect(schedule).toContain("{ limit: tenant?.weekly_peak_limit ?? null, days: tenant?.weekly_peak_days ?? null }");
  });
});

// ── DB ──────────────────────────────────────────────────────────────────
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const MIG = "supabase/migrations/20261022010000_weekly_peak_days.sql";
const SQL = noComments(readFileSync(MIG, "utf8"));
const fnBody = (sql: string, name: string): string => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return "";
  const end = sql.indexOf("$fn$;", start);
  return sql.slice(start, end > 0 ? end : undefined);
};
const latestDefinition = (name: string): { file: string; body: string } => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  let hit = { file: "", body: "" };
  for (const f of files) {
    const body = fnBody(noComments(readFileSync(`supabase/migrations/${f}`, "utf8")), name);
    if (body) hit = { file: f, body };
  }
  return hit;
};

describe("DB: 設定の列", () => {
  it("NULL 可・既定なし（NULL＝今まで通り）。人数は1以上、日数は1〜6", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS weekly_peak_limit integer;/);
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS weekly_peak_days integer;/);
    expect(SQL).toMatch(/CHECK \(weekly_peak_limit IS NULL OR weekly_peak_limit >= 1\)/);
    expect(SQL).toMatch(/CHECK \(weekly_peak_days IS NULL OR weekly_peak_days BETWEEN 1 AND 6\)/);
  });

  it("特定のジムの値を migration に書かない（リポジトリは public）", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(SQL).not.toMatch(/UPDATE\s+public\.tenants/i);
  });
});

describe("DB: 上限の計算は tenant_member_day_limits の1か所", () => {
  const limits = fnBody(SQL, "tenant_member_day_limits");
  const counts = fnBody(SQL, "tenant_member_day_counts");

  it("会員の数え方は tenant_day_booking_count と同じ（キャンセル済み以外・JST）", () => {
    expect(counts).toContain("b.status <> 'キャンセル済み'");
    expect(counts).toContain("(b.booking_date AT TIME ZONE 'Asia/Tokyo')::date");
    expect(counts).toContain("FROM public.bookings b");
    expect(counts).not.toContain("trial_bookings");
  });

  it("🔴 範囲の両端を含む週をまるごと数える（範囲の外の日も多い日になりうる）", () => {
    expect(limits).toContain("date_trunc('week', from_date::timestamp)::date AS w0");
    expect(limits).toContain("date_trunc('week', to_date::timestamp)::date + 6 AS w1");
  });

  it("🔴 週は月曜始まり（date_trunc('week') は ISO 週＝月曜）", () => {
    expect(limits).toMatch(/date_trunc\('week', d::timestamp\)::date/);
    expect(limits).not.toMatch(/\bdow\b/i);
  });

  it("🔴 その日自身は数えない・上限を外した日は数えない", () => {
    expect(limits).toContain("p.day <> d::date");
    expect(limits).toMatch(/c\.n >= t\.peak\s+AND NOT EXISTS \(SELECT 1 FROM uncapped x WHERE x\.day = c\.day\)/);
  });

  it("設定が無い・人数が会員の上限以下なら今まで通り", () => {
    expect(limits).toContain("WHEN t.peak IS NULL OR t.peak_days IS NULL OR t.peak <= t.lim THEN t.lim");
  });

  it("内部用の関数は外から呼ばせない", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.tenant_member_day_counts\(uuid, date, date, uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.tenant_member_day_limits\(uuid, date, date, uuid\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("DB: 3か所とも同じ計算を使う", () => {
  it("🔴 会員の自己予約の判定・カレンダーの受付終了・残り枠", () => {
    for (const name of ["tenant_day_closed", "get_tenant_closed_days", "get_tenant_daily_limit_left"]) {
      const { file, body } = latestDefinition(name);
      expect(body, `${name} の最後の定義（${file}）が週の多い日を見ていない`).toContain("public.tenant_member_day_limits(");
      // 合計の上限（体験込み）はそのまま（宗本さん「合計5人のまま」）
      expect(body, `${name}（${file}）`).toMatch(/tenant_day_total_reached|tenant_day_trial_count/);
    }
  });

  it("会員の自己予約の判定: 順番は今まで通り（手で止めた日 → 上限を外した日 → 会員の上限 → 合計の上限）", () => {
    const closed = fnBody(SQL, "tenant_day_closed");
    const at = (s: string) => closed.indexOf(s);
    expect(at("booking_closed_days")).toBeGreaterThan(0);
    expect(at("booking_closed_days")).toBeLessThan(at("booking_uncapped_days"));
    expect(at("booking_uncapped_days")).toBeLessThan(at("tenant_member_day_limits"));
    expect(at("tenant_member_day_limits")).toBeLessThan(at("tenant_day_total_reached"));
    expect(closed).toContain("p_exclude_booking_id) l;"); // 予約の変更では動かす予約を数えない
  });

  it("🔴 会員のガードは店・週ごとのロックを取ってから数える（別の日の5人目が同時に通らない）", () => {
    const guard = fnBody(SQL, "guard_booking_day_closed");
    const lock = guard.indexOf("pg_advisory_xact_lock(");
    expect(lock).toBeGreaterThan(0);
    expect(guard).toContain("date_trunc('week', v_date::timestamp)");
    expect(lock).toBeLessThan(guard.indexOf("public.tenant_day_closed(NEW.tenant_id, v_date, NEW.id)"));
    // 店の代理予約・取り込みは今まで通り通す（ロックも取らない）
    expect(guard.indexOf("v_actor IS DISTINCT FROM NEW.user_id")).toBeLessThan(lock);
    expect(guard.indexOf("salute_sync")).toBeLessThan(lock);
  });

  it("権限は今まで通り（カレンダーは未ログインにも、残り枠はログインした会員だけ）", () => {
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_closed_days\(uuid, date, date\) TO anon, authenticated;/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.get_tenant_daily_limit_left\(uuid, date, date\) FROM PUBLIC, anon;/);
    expect(fnBody(SQL, "get_tenant_daily_limit_left")).toMatch(/IF v_uid IS NULL OR NOT public\.is_tenant_member\(p_tenant_id, v_uid\) THEN\s+RETURN;/);
  });
});

// ── 設定画面 ─────────────────────────────────────────────────────────────
describe("設定（予約のルール → 1日の上限人数）", () => {
  const renderCard = async () => {
    const { default: TrainerDailyBookingLimit } = await import("@/components/trainer/TrainerDailyBookingLimit");
    return render(<TrainerDailyBookingLimit />);
  };
  const save = () => fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));

  it("「週に何日か、上限を増やす」が出て、今の値が選ばれている", async () => {
    await renderCard();
    expect(screen.getByText(i18n.t("closedDays.peakLabel"))).toBeTruthy();
    expect(screen.getByText(i18n.t("closedDays.peakDaysUnit", { count: 2 }))).toBeTruthy();
    expect(screen.getAllByText(i18n.t("closedDays.limitUnit", { count: 5 })).length).toBeGreaterThan(0);
  });

  it("保存すると日数と人数も書く", async () => {
    await renderCard();
    save();
    await waitFor(() =>
      expect(updates).toEqual([{ daily_booking_limit: 4, daily_total_limit: 5, weekly_peak_days: 2, weekly_peak_limit: 5 }]),
    );
  });

  it("🔴 設定していない店は「増やさない」のまま保存される（今まで通り）", async () => {
    tenantRef.current = { id: "t1", daily_booking_limit: 4, daily_total_limit: 5, weekly_peak_days: null, weekly_peak_limit: null };
    await renderCard();
    save();
    await waitFor(() =>
      expect(updates).toEqual([{ daily_booking_limit: 4, daily_total_limit: 5, weekly_peak_days: null, weekly_peak_limit: null }]),
    );
  });

  it("🔴 人数が会員の上限以下なら保存しない（増やす意味が無い）", async () => {
    tenantRef.current = { id: "t1", daily_booking_limit: 5, daily_total_limit: 5, weekly_peak_days: 2, weekly_peak_limit: 5 };
    await renderCard();
    save();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(i18n.t("closedDays.peakInvalid")));
    expect(updates).toEqual([]);
  });

  it("会員の上限が「上限なし」なら、増やす設定も外して保存する", async () => {
    tenantRef.current = { id: "t1", daily_booking_limit: null, daily_total_limit: null, weekly_peak_days: 2, weekly_peak_limit: 5 };
    await renderCard();
    save();
    await waitFor(() =>
      expect(updates).toEqual([{ daily_booking_limit: null, daily_total_limit: null, weekly_peak_days: null, weekly_peak_limit: null }]),
    );
  });
});

describe("店の設定の読み込み（tenantColumns）", () => {
  it("取得する列に入っている。列が読めない環境の既定は「増やさない」（null）", () => {
    expect(tenantOptionalColumnNames()).toEqual(expect.arrayContaining(["weekly_peak_limit", "weekly_peak_days"]));
    expect(TENANT_VALUE_DEFAULTS.weekly_peak_limit).toBeNull();
    expect(TENANT_VALUE_DEFAULTS.weekly_peak_days).toBeNull();
    expect(normalizeTenantRow({ id: "t1" }).weekly_peak_limit).toBeNull();
  });
});

describe("説明文（5言語）", () => {
  const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  const KEYS = ["peakLabel", "peakDaysAria", "peakNone", "peakDaysUnit", "peakLimitAria", "peakLimitPlaceholder", "peakDesc", "peakInvalid"];
  it("8つのキーが5言語そろっている", () => {
    for (const l of LANGS) {
      const c = JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8")).closedDays;
      for (const k of KEYS) expect(c[k], `${l} ${k}`).toBeTruthy();
      expect(c.peakDaysUnit, l).toContain("{{count}}");
    }
  });
});
