/**
 * 曜日ごとの会員の1日の上限（tenants.daily_booking_limit_weekdays・2026-10-28）。
 *
 * 宗本さん（設定画面「1日の上限人数」のスクリーンショット）「これ、曜日ごとに上限設定できる様にもして」。
 * 確認: 1. 曜日ごとに会員の人数を決める。「週に何日か増やす」も一緒に使える（曜日の人数より多くできる）
 *       2. 体験も含めた合計の上限は全曜日同じ
 *
 * 🔴 壊しやすいもの:
 *   1. 曜日の数え方がずれる（0=日曜。DB は isodow % 7、画面は UTC の getUTCDay）
 *   2. もともと6人の曜日の6人目を「増やした日」に数え、ほかの曜日の枠を減らす
 *   3. 曜日の上限を超えた日（例: 日曜4人の日の5人目）を「増やした日」に数え忘れる
 *   4. 使っていない店の動きが変わる（列が NULL なら今まで通り）
 *   5. 共通が「上限なし」で曜日だけ上限がある店に、残り枠が出ない
 *   6. CHECK の関数を店のスタッフが実行できず、設定の保存が全部落ちる
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import {
  WEEKDAY_ORDER, baseLimitOn, baseLimits, minBaseLimit, parseWeekdayLimits, weekdayLimitsToJson, weekdayOf,
} from "@/lib/weekdayLimits";
import { memberLimitOn, weeklyPeakEnabled, weeklyPeakSaveValues, type WeeklyPeakSettings } from "@/lib/weeklyPeak";
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
  useUncappedDays: () => ({ uncappedDays: [], refetch: vi.fn() }),
  useUncapDay: () => ({ uncap: vi.fn(), recap: vi.fn(), saving: false }),
}));

beforeEach(() => {
  updates.length = 0;
  toastError.mockClear();
  tenantRef.current = {
    id: "t1", daily_booking_limit: 5, daily_total_limit: 6, weekly_peak_days: 3, weekly_peak_limit: 6,
    daily_booking_limit_weekdays: { "0": 4, "2": 6 },
  };
});
afterEach(cleanup);

// 2027-03-01 は月曜。日曜4人・火曜6人・ほか5人、週に3日まで6人（本番で試した組み合わせと同じ）
const SUN = 0, TUE = 2;
const WD = [4, null, 6, null, null, null, null];
const S: WeeklyPeakSettings = { dailyLimit: 5, peakLimit: 6, peakDays: 3, weekdayLimits: WD };
const WEEK = ["2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-06", "2027-03-07"];
const counts = (m: Record<string, number>) => (k: string) => m[k] ?? 0;
const none = () => false;
const limitsOf = (s: WeeklyPeakSettings, c: (k: string) => number) => WEEK.map((k) => memberLimitOn(k, s, c, none));

describe("曜日の上限（src/lib/weekdayLimits.ts）", () => {
  it("DB の値を7曜日の配列に。曜日の指定が無ければ null（全曜日共通）", () => {
    expect(parseWeekdayLimits({ "0": 4, "2": 6 })).toEqual(WD);
    expect(parseWeekdayLimits(null)).toBeNull();
    expect(parseWeekdayLimits({})).toBeNull();
    // 形の合わないもの（範囲外・小数・文字・配列）は読まない（DB の CHECK と同じ）
    expect(parseWeekdayLimits({ "7": 3, "1": 0, "3": 5.5, "4": "5", "5": 100 })).toBeNull();
    expect(parseWeekdayLimits([4, 5])).toBeNull();
  });

  it("保存の形: 指定した曜日だけ。1つも無ければ null", () => {
    expect(weekdayLimitsToJson(WD)).toEqual({ "0": 4, "2": 6 });
    expect(weekdayLimitsToJson(Array(7).fill(null))).toBeNull();
    expect(weekdayLimitsToJson(null)).toBeNull();
  });

  it("🔴 曜日は 0=日曜〜6=土曜。端末のタイムゾーンに左右されない（UTC で数える）", () => {
    expect(weekdayOf("2027-03-01")).toBe(1); // 月
    expect(weekdayOf("2027-03-07")).toBe(SUN);
    expect(weekdayOf("2027-03-02")).toBe(TUE);
    expect(baseLimitOn("2027-03-07", 5, WD)).toBe(4);
    expect(baseLimitOn("2027-03-02", 5, WD)).toBe(6);
    expect(baseLimitOn("2027-03-03", 5, WD)).toBe(5); // 共通
    expect(baseLimits(5, WD)).toEqual([4, 5, 6, 5, 5, 5, 5]);
    expect(minBaseLimit(5, WD)).toBe(4);
    expect(minBaseLimit(null, null)).toBeNull();
    expect(minBaseLimit(null, WD)).toBe(4);
  });

  it("画面の並びは月曜〜日曜（「週に何日か増やす」の週と同じ）", () => {
    expect(WEEKDAY_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe("その日の会員の上限（曜日の上限 ＋ 週に何日か増やす）", () => {
  it("増やした日がまだ無い週は、どの日も6人", () => {
    expect(limitsOf(S, counts({}))).toEqual([6, 6, 6, 6, 6, 6, 6]);
  });

  it("🔴 月6・火6・水6・日5 → 増やした日は月・水・日の3日（火はもともと6人なので数えない）→ 木〜土は5人", () => {
    const c = counts({ "2027-03-01": 6, "2027-03-02": 6, "2027-03-03": 6, "2027-03-07": 5 });
    expect(limitsOf(S, c)).toEqual([6, 6, 6, 5, 5, 5, 6]);
  });

  it("🔴 もともと6人の曜日（火）の6人目は「増やした日」に数えない", () => {
    const c = counts({ "2027-03-01": 6, "2027-03-02": 6, "2027-03-03": 6 });
    // 増やした日は月・水の2日 → まだ3日に届かない → 木も6人まで
    expect(memberLimitOn("2027-03-04", S, c, none)).toBe(6);
  });

  it("🔴 日曜（4人）の5人目は「増やした日」に数える（6人に届いていなくても）", () => {
    const c = counts({ "2027-03-01": 6, "2027-03-03": 6, "2027-03-07": 5 });
    expect(memberLimitOn("2027-03-04", S, c, none)).toBe(5);
  });

  it("キャンセルで増やした日が減れば、ほかの日がまた6人まで", () => {
    const c = counts({ "2027-03-01": 5, "2027-03-02": 6, "2027-03-03": 6, "2027-03-04": 5, "2027-03-07": 5 });
    expect(limitsOf(S, c)).toEqual([6, 6, 6, 6, 6, 6, 6]);
  });

  it("増やせない曜日（曜日の上限が増やす人数以上）はそのまま", () => {
    const s = { ...S, weekdayLimits: [4, null, 8, null, null, null, null] };
    expect(memberLimitOn("2027-03-02", s, counts({}), none)).toBe(8);
  });

  it("曜日だけ（共通は上限なし・日曜4人）: 日曜だけ上限、ほかは上限なし", () => {
    const s: WeeklyPeakSettings = { dailyLimit: null, peakLimit: null, peakDays: null, weekdayLimits: [4, null, null, null, null, null, null] };
    expect(limitsOf(s, counts({}))).toEqual([null, null, null, null, null, null, 4]);
  });

  it("🔴 曜日ごとの設定が無ければ今まで通り（5人・週3日まで6人）", () => {
    const s: WeeklyPeakSettings = { dailyLimit: 5, peakLimit: 6, peakDays: 3 };
    const c = counts({ "2027-03-01": 6, "2027-03-02": 6, "2027-03-03": 6 });
    expect(limitsOf(s, c)).toEqual([6, 6, 6, 5, 5, 5, 5]);
  });

  it("🔴 一律4・増やした日6・週2日: 5人の日も「増やした日」（以前は数えず、どの日も5人まで入った）", () => {
    const s: WeeklyPeakSettings = { dailyLimit: 4, peakLimit: 6, peakDays: 2 };
    const c = counts({ "2027-03-01": 5, "2027-03-02": 5 });
    expect(limitsOf(s, c)).toEqual([6, 6, 4, 4, 4, 4, 4]);
  });
});

describe("週に何日か増やす: 効いているか・保存の値（曜日ごとの上限込み）", () => {
  it("どれかの曜日の上限より大きければ効く", () => {
    expect(weeklyPeakEnabled({ dailyLimit: 6, peakLimit: 5, peakDays: 1, weekdayLimits: WD })).toBe(true); // 日曜4 < 5
    expect(weeklyPeakEnabled({ dailyLimit: 6, peakLimit: 5, peakDays: 1 })).toBe(false);
    expect(weeklyPeakEnabled({ dailyLimit: null, peakLimit: 5, peakDays: 1, weekdayLimits: null })).toBe(false);
  });

  it("保存: いちばん少ない曜日より多い人数だけ。上限のある曜日が無ければ増やさない", () => {
    expect(weeklyPeakSaveValues(5, 3, 6, WD)).toEqual({ weekly_peak_days: 3, weekly_peak_limit: 6 });
    expect(weeklyPeakSaveValues(6, 1, 5, WD)).toEqual({ weekly_peak_days: 1, weekly_peak_limit: 5 });
    expect(weeklyPeakSaveValues(5, 3, 4, WD)).toBe("invalid");
    expect(weeklyPeakSaveValues(null, 2, 5, [4, null, null, null, null, null, null])).toEqual({ weekly_peak_days: 2, weekly_peak_limit: 5 });
    expect(weeklyPeakSaveValues(null, 2, 5, null)).toEqual({ weekly_peak_days: null, weekly_peak_limit: null });
  });
});

describe("予定表の n/◯人（useDayReception）", () => {
  it("🔴 店の値（jsonb）をそのまま渡すと、曜日の上限を出す", async () => {
    const { useDayReception } = await import("@/hooks/useDayReception");
    const { result } = renderHook(() =>
      useDayReception("2027-03-01", "2027-03-07", [], 5, { limit: null, days: null }, null, { "0": 4, "2": 6 }),
    );
    expect(result.current.dailyLimitOn("2027-03-07")).toBe(4);
    expect(result.current.dailyLimitOn("2027-03-02")).toBe(6);
    expect(result.current.dailyLimitOn("2027-03-03")).toBe(5);
  });

  it("予定表は店の曜日ごとの上限を渡している", () => {
    const schedule = readFileSync("src/components/trainer/TrainerSchedule.tsx", "utf8");
    expect(schedule).toContain("tenant?.daily_booking_limit_weekdays ?? null,");
  });
});

// ── 設定画面 ─────────────────────────────────────────────────────────────
describe("設定（予約のルール → 1日の上限人数 → 曜日ごとに変える）", () => {
  const renderCard = async () => {
    const { default: TrainerDailyBookingLimit } = await import("@/components/trainer/TrainerDailyBookingLimit");
    return render(<TrainerDailyBookingLimit />);
  };
  const save = () => fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }));
  const dayTrigger = (day: number) =>
    screen.getByRole("combobox", { name: i18n.t("closedDays.weekdayAria", { day: i18n.t(`progress.dow${day}`) }) });

  it("保存済みの曜日の上限が出る（日4・火6・ほかは共通）", async () => {
    await renderCard();
    const section = screen.getByTestId("weekday-limits");
    expect(within(section).getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(dayTrigger(SUN).textContent).toContain(i18n.t("closedDays.limitUnit", { count: 4 }));
    expect(dayTrigger(TUE).textContent).toContain(i18n.t("closedDays.limitUnit", { count: 6 }));
    // 閉じているときは「共通」だけ（スマホの幅で切れないように。値はすぐ上の1日の上限）
    expect(dayTrigger(1).textContent).toBe(i18n.t("closedDays.weekdayCommonShort"));
    expect(screen.getByText(i18n.t("closedDays.peakDescWeekday"))).toBeTruthy();
  });

  it("保存すると曜日の上限も書く", async () => {
    await renderCard();
    save();
    await waitFor(() =>
      expect(updates).toEqual([{
        daily_booking_limit: 5, daily_total_limit: 6, weekly_peak_days: 3, weekly_peak_limit: 6,
        daily_booking_limit_weekdays: { "0": 4, "2": 6 },
      }]),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("🔴「曜日ごとに変える」を OFF にして保存すると NULL（全曜日共通に戻す）", async () => {
    await renderCard();
    fireEvent.click(within(screen.getByTestId("weekday-limits")).getByRole("switch"));
    expect(screen.queryByRole("combobox", { name: i18n.t("closedDays.weekdayAria", { day: i18n.t("progress.dow0") }) })).toBeNull();
    save();
    await waitFor(() => expect(updates).toEqual([expect.objectContaining({ daily_booking_limit_weekdays: null })]));
  });

  it("🔴 使っていない店は今まで通り（列に触らない・曜日の選択も出ない）", async () => {
    tenantRef.current = { id: "t1", daily_booking_limit: 5, daily_total_limit: 6, weekly_peak_days: 3, weekly_peak_limit: 6, daily_booking_limit_weekdays: null };
    await renderCard();
    expect(within(screen.getByTestId("weekday-limits")).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(i18n.t("closedDays.weekdayDesc"))).toBeNull();
    save();
    await waitFor(() =>
      expect(updates).toEqual([{ daily_booking_limit: 5, daily_total_limit: 6, weekly_peak_days: 3, weekly_peak_limit: 6 }]),
    );
  });

  it("ON にしただけ（どの曜日も共通）なら NULL を書く", async () => {
    tenantRef.current = { id: "t1", daily_booking_limit: 5, daily_total_limit: 6, weekly_peak_days: null, weekly_peak_limit: null, daily_booking_limit_weekdays: null };
    await renderCard();
    fireEvent.click(within(screen.getByTestId("weekday-limits")).getByRole("switch"));
    expect(screen.getByText(i18n.t("closedDays.weekdayDesc"))).toBeTruthy();
    save();
    await waitFor(() => expect(updates).toEqual([expect.objectContaining({ daily_booking_limit_weekdays: null })]));
  });

  it("共通が「上限なし」でも、曜日の上限があれば「週に何日か増やす」を選べる", async () => {
    tenantRef.current = { id: "t1", daily_booking_limit: null, daily_total_limit: null, weekly_peak_days: 1, weekly_peak_limit: 5, daily_booking_limit_weekdays: { "0": 4 } };
    await renderCard();
    expect(screen.getByRole("combobox", { name: i18n.t("closedDays.peakDaysAria") }).hasAttribute("disabled")).toBe(false);
    expect(dayTrigger(1).textContent).toBe(i18n.t("closedDays.weekdayCommonShort"));
    save();
    await waitFor(() =>
      expect(updates).toEqual([{
        daily_booking_limit: null, daily_total_limit: null, weekly_peak_days: 1, weekly_peak_limit: 5,
        daily_booking_limit_weekdays: { "0": 4 },
      }]),
    );
  });
});

describe("店の設定の読み込み（tenantColumns）", () => {
  it("取得する列に入っている。列が読めない環境の既定は「全曜日共通」（null）", () => {
    expect(tenantOptionalColumnNames()).toContain("daily_booking_limit_weekdays");
    expect(TENANT_VALUE_DEFAULTS.daily_booking_limit_weekdays).toBeNull();
    expect(normalizeTenantRow({ id: "t1" }).daily_booking_limit_weekdays).toBeNull();
  });
});

// ── DB ──────────────────────────────────────────────────────────────────
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const MIG = "supabase/migrations/20261028010000_weekday_booking_limits.sql";
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
  it("jsonb・NULL 可・既定なし（NULL＝全曜日共通＝今まで通り）", () => {
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS daily_booking_limit_weekdays jsonb;/);
    expect(SQL).not.toMatch(/daily_booking_limit_weekdays jsonb\s+(NOT NULL|DEFAULT)/);
  });

  it("形の確認: キーは 0〜6、値は 1〜99 の整数（画面の WEEKDAY_LIMIT_MAX と同じ）", () => {
    const valid = fnBody(SQL, "weekday_limits_valid");
    expect(valid).toContain("IMMUTABLE");
    expect(valid).toContain("e.key NOT IN ('0', '1', '2', '3', '4', '5', '6')");
    expect(valid).toContain("NOT BETWEEN 1 AND 99");
    expect(SQL).toMatch(/CHECK \(public\.weekday_limits_valid\(daily_booking_limit_weekdays\)\)/);
  });

  it("🔴 CHECK の関数は店のスタッフが実行できる（外すと設定の保存が全部落ちる）", () => {
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.weekday_limits_valid\(jsonb\) TO anon, authenticated, service_role;/);
    expect(SQL).not.toMatch(/REVOKE[^;]*weekday_limits_valid/);
  });

  it("特定のジムの値を migration に書かない（リポジトリは public）", () => {
    expect(SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(SQL).not.toMatch(/UPDATE\s+public\.tenants/i);
  });
});

describe("DB: 上限の計算（tenant_member_day_limits）", () => {
  const { file, body } = latestDefinition("tenant_member_day_limits");

  it("最後の定義がこの migration", () => {
    expect(file).toBe("20261028010000_weekday_booking_limits.sql");
  });

  it("🔴 曜日の上限を引く。曜日は 0=日曜（isodow % 7）、無ければ共通の上限", () => {
    expect(body).toContain("COALESCE((t.wd ->> (extract(isodow FROM g::date)::integer % 7)::text)::integer, t.lim) AS base");
  });

  it("🔴 増やした日 = 増やせる曜日で、曜日の上限を超えて入った日（もともと多い曜日は数えない）", () => {
    expect(body).toContain("AND d.base IS NOT NULL AND d.base < t.peak");
    expect(body).toContain("AND c.n > d.base");
    expect(body).toContain("r.day <> d.day");
  });

  it("上限を外した日は上限なし・増やした日にも数えない", () => {
    expect(body).toContain("WHEN EXISTS (SELECT 1 FROM uncapped x WHERE x.day = d.day) THEN NULL");
    expect(body).toMatch(/AND NOT EXISTS \(SELECT 1 FROM uncapped x WHERE x\.day = d\.day\)\s+\)/);
  });

  it("内部用の関数は外から呼ばせない（今まで通り）", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.tenant_member_day_limits\(uuid, date, date, uuid\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("DB: 残り枠（get_tenant_daily_limit_left）", () => {
  const { file, body } = latestDefinition("get_tenant_daily_limit_left");

  it("🔴 共通が「上限なし」でも、曜日の上限があれば返す。上限の無い日は返さない", () => {
    expect(file).toBe("20261028010000_weekday_booking_limits.sql");
    expect(body).toContain("IF v_limit IS NULL AND v_total IS NULL AND v_weekdays IS NULL THEN");
    expect(body).toContain("AND (l.member_limit IS NOT NULL OR v_total IS NOT NULL)");
  });

  it("今まで通り: 自分のジムの会員だけ・同じ計算・合計の上限（体験込み）も見る", () => {
    expect(body).toMatch(/IF v_uid IS NULL OR NOT public\.is_tenant_member\(p_tenant_id, v_uid\) THEN\s+RETURN;/);
    expect(body).toContain("public.tenant_member_day_limits(");
    expect(body).toContain("public.tenant_day_trial_count(");
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.get_tenant_daily_limit_left\(uuid, date, date\) FROM PUBLIC, anon;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_tenant_daily_limit_left\(uuid, date, date\) TO authenticated;/);
  });

  it("🔴 合計の上限（体験込み）は全曜日同じのまま（その関数には触らない）", () => {
    expect(fnBody(SQL, "tenant_day_total_reached")).toBe("");
    expect(fnBody(SQL, "get_tenant_trial_closed_days")).toBe("");
  });
});

describe("文言（5言語）", () => {
  const LANGS = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
  it("曜日ごとの文言と曜日の名前がそろっている", () => {
    for (const l of LANGS) {
      const j = JSON.parse(readFileSync(`src/locales/${l}.json`, "utf8"));
      for (const k of ["weekdayToggle", "weekdayCommon", "weekdayCommonShort", "weekdayAria", "weekdayDesc", "peakDescWeekday"]) {
        expect(j.closedDays[k], `${l} ${k}`).toBeTruthy();
      }
      expect(j.closedDays.weekdayCommon, l).toContain("{{limit}}");
      expect(j.closedDays.weekdayAria, l).toContain("{{day}}");
      for (let d = 0; d < 7; d++) expect(j.progress[`dow${d}`], `${l} dow${d}`).toBeTruthy();
    }
  });
});
