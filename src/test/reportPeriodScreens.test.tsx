/**
 * レポートの画面が、プロフィールのカードの「利用期間」と同じ期間を出して、その期間のデータを読む（2026-10-15）。
 *
 * 宗本さん: 回数を「区切りの1回目の日から1ヶ月」で数えるように直したあと、
 * 月次レポート・部位バランス・ホームの「今回のレポート」の期間も「揃えて」。
 *
 * 🔴 壊しやすいもの:
 *   1. 期間の計算（src/lib/reportPeriod.ts）を通さず、画面ごとに暦で区切り直す
 *   2. トレーナーのお客様詳細の部位バランスが、そのお客様ではなく自分（トレーナー）の予約で期間を出す
 *   3. 材料の読み込み中に、違う期間のデータを読みに行く
 *   4. 回数券などのお客様まで期間の出し方が変わる
 *
 * 日付は本番の実データ（名前は持たない）: 起算日 10/6・月4回・予約 9/10, 9/14, 10/22, 10/29, 11/5, 11/12。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";

type Call = { table: string; ops: unknown[][] };
const h = vi.hoisted(() => {
  const calls: { table: string; ops: unknown[][] }[] = [];
  const chain = (table: string) => {
    const rec = { table, ops: [] as unknown[][] };
    calls.push(rec);
    const result = { data: table === "monthly_reports" ? null : [], error: null };
    const self: unknown = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve(result);
        return (...args: unknown[]) => { rec.ops.push([prop, ...args]); return self; };
      },
    });
    return self;
  };
  return {
    me: { id: "me" },
    calls,
    chain,
    profile: null as Record<string, unknown> | null,
    myBookings: [] as { date: string; startTime: string; status: string }[],
    myBookingsLoading: false,
    plans: [] as Record<string, unknown>[],
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => h.chain(t) } }));
// 「今」は 11/15 12:00 JST に固定する（Date ごと止めると waitFor の時間切れも止まるので、ここだけ）
vi.mock("@/lib/timezone", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/timezone")>();
  return { ...orig, getJSTNow: () => orig.toJSTDate("2026-11-15T12:00:00+09:00") };
});
// user は毎回同じものを返す（本物と同じ。毎回作ると、user を見ている読み込みが止まらなくなる）
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.me }) }));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ profile: h.profile, loading: false }) }));
vi.mock("@/hooks/useTenant", () => ({ useTenant: () => ({ allPlans: h.plans, plans: h.plans, tenant: { id: "t1" } }) }));
vi.mock("@/hooks/useStreak", () => ({ useStreak: () => ({ currentStreak: 0, bestStreak: 0 }) }));
vi.mock("@/hooks/useBookings", () => ({
  SAME_DAY_FORFEIT_STATUS: "当日キャンセル",
  useMyBookings: () => ({ bookings: h.myBookings, loading: h.myBookingsLoading }),
}));
vi.mock("@/lib/muscleGroup", () => ({
  getMuscleGroup: () => "A",
  loadMuscleGroupMap: () => Promise.resolve(),
  subscribeMuscleGroup: () => () => {},
  summarizeMuscleGroups: () => [],
}));
vi.mock("@/lib/tenantMuscleGroups", () => ({
  getTenantMuscleGroups: () => [{ name: "A" }, { name: "B" }, { name: "C" }],
  loadTenantMuscleGroups: () => Promise.resolve(),
  subscribeTenantMuscleGroups: () => () => {},
}));

const { default: MuscleBalanceRadar } = await import("@/components/customer/MuscleBalanceRadar");
const { default: CustomerMonthlyReport } = await import("@/components/customer/CustomerMonthlyReport");

const ROWS: [string, string][] = [["2026-09-10", "21:30"], ["2026-09-14", "17:00"], ["2026-10-22", "17:30"], ["2026-10-29", "17:00"], ["2026-11-05", "16:00"], ["2026-11-12", "17:30"]];
const PROFILE = { plan: "月4回", cycle_start_date: "2026-10-06", cycle_start_pinned: false, grace_enabled: true, display_name: "x" };
const SOURCE = {
  planName: "月4回", cycleStartDate: "2026-10-06", cycleStartPinned: false, graceEnabled: true, tenantPlans: [],
  bookings: ROWS.map(([d, t]) => ({ booking_date: `${d}T${t}:00+09:00`, status: "予約済み" })),
};
/** あるテーブルへの問い合わせのうち、その列への条件 [op, 値] を順に */
const filtersOn = (table: string, column: string) =>
  h.calls.filter((c: Call) => c.table === table).map((c: Call) => c.ops.filter((o) => o[1] === column && o[0] !== "order").map((o) => `${String(o[0])}:${String(o[2])}`).join(" "));

beforeEach(() => {
  h.calls.length = 0;
  h.profile = { ...PROFILE };
  h.myBookings = ROWS.map(([date, startTime]) => ({ date, startTime, status: "予約済み" }));
  h.myBookingsLoading = false;
  h.plans = [];
});
afterEach(() => { cleanup(); });

describe("部位バランス", () => {
  it("🔴 トレーナーのお客様詳細: そのお客様の利用期間（10/22〜11/22）で、その期間の記録を読む", async () => {
    h.myBookings = []; // トレーナー自身の予約は使わない
    render(<MuscleBalanceRadar userId="client-1" periodSource={SOURCE} />);
    expect(screen.getByText("10/22〜11/22")).toBeTruthy();
    expect(screen.getByText(i18n.t("muscleBalance.thisPeriod"))).toBeTruthy();
    await waitFor(() => expect(filtersOn("workouts", "workout_date")).toEqual(["gte:2026-10-22 lt:2026-11-23"]));
    const userFilter = h.calls[0].ops.find((o) => o[0] === "eq");
    expect(userFilter).toEqual(["eq", "user_id", "client-1"]);
  });

  it("前へ: 1回目の前日までの期間（9/22〜10/21）・「前回」", async () => {
    render(<MuscleBalanceRadar userId="client-1" periodSource={SOURCE} />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("muscleBalance.prevPeriod") }));
    expect(screen.getByText("9/22〜10/21")).toBeTruthy();
    expect(screen.getByText(i18n.t("muscleBalance.lastPeriod"))).toBeTruthy();
    await waitFor(() => expect(filtersOn("workouts", "workout_date")).toContain("gte:2026-09-22 lt:2026-10-22"));
  });

  it("お客様自身の画面: 自分のプロフィールと予約から同じ期間", async () => {
    render(<MuscleBalanceRadar />);
    expect(screen.getByText("10/22〜11/22")).toBeTruthy();
    await waitFor(() => expect(filtersOn("workouts", "workout_date")).toEqual(["gte:2026-10-22 lt:2026-11-23"]));
  });

  it("材料の読み込み中は読みに行かない（違う期間を一瞬読まない）", async () => {
    render(<MuscleBalanceRadar userId="client-1" periodSource={null} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls.filter((c: Call) => c.table === "workouts")).toEqual([]);
  });

  it("回数券のお客様は従来どおり暦の月（2026年11月・今月）", async () => {
    const ticket = { ...SOURCE, planName: "回数券10回", tenantPlans: [{ plan_name: "回数券10回", plan_type: "ticket", max_sessions: 10, validity_days: 90 }] };
    render(<MuscleBalanceRadar userId="client-1" periodSource={ticket} />);
    expect(screen.getByText("2026年11月")).toBeTruthy();
    expect(screen.getByText(i18n.t("muscleBalance.thisMonth"))).toBeTruthy();
    await waitFor(() => expect(filtersOn("workouts", "workout_date")).toEqual(["gte:2026-11-01 lt:2026-12-01"]));
  });
});

describe("月次レポート", () => {
  it("🔴 期間はカードの利用期間（10/22〜11/22・今回）。記録はその期間、比べる「前回」は 9/22〜10/21", async () => {
    render(<CustomerMonthlyReport onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("10/22〜11/22")).toBeTruthy());
    expect(screen.getByText(i18n.t("report.currentCycleBadge"))).toBeTruthy();
    expect(filtersOn("workouts", "workout_date")).toEqual(["gte:2026-10-22 lt:2026-11-23", "gte:2026-09-22 lt:2026-10-22"]);
    expect(filtersOn("user_measurements", "measured_date")[0]).toContain("gte:2026-10-22");
  });

  it("トレーナーの月次コメントは、期間が始まった月（10月）のものを出す", async () => {
    render(<CustomerMonthlyReport onBack={() => {}} />);
    await waitFor(() => expect(filtersOn("monthly_reports", "month")).toEqual(["eq:2026-10-01"]));
  });

  it("材料（予約）の読み込み中は読みに行かない", async () => {
    h.myBookingsLoading = true;
    render(<CustomerMonthlyReport onBack={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls).toEqual([]);
  });
});

describe("ホームの「今回のレポート」", () => {
  it("来店の数え方は、カードと同じ期間（reportPeriodAt）を通す", () => {
    const src = readFileSync("src/components/customer/CustomerHome.tsx", "utf8");
    const block = src.slice(src.indexOf('t("home.thisReport")'), src.indexOf('t("home.visitsCount"'));
    expect(block).toContain("reportPeriodAt(");
  });
});
