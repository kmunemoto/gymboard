/**
 * レポートの期間を、プロフィールのカードの「利用期間」と同じ区切りにする（2026-10-15）。
 *
 * 宗本さん: 回数を「区切りの1回目の日から1ヶ月」で数えるように直したあと、
 * 月次レポート・部位バランス・ホームの「今回のレポート」の期間も「揃えて」。
 *
 * 🔴 壊しやすいもの:
 *   1. 「今回」がカードの利用期間と違う日付になる
 *   2. 前の期間に隙間や重なりができる（同じ来店が2つのレポートに出る／どこにも出ない）
 *   2'. 区切りの間が数日空くたびに、数日だけの期間ができる
 *   3. 猶予で前回分に回した来店（チップの「8/8 前回分」）が、次の期間のレポートに入る
 *   4. 使い切って次の区切りに移った来店が、前の期間のレポートに入る
 *   5. 回数券・期間プラン・起算日なしのお客様の表示まで変わる
 *
 * 日付は本番の実データ（名前は持たない）。
 */
import { describe, it, expect } from "vitest";
import { addDays, format, startOfDay } from "date-fns";
import { reportPeriodAt, reportPeriodLabel, type ReportPeriod, type ReportPeriodSource } from "@/lib/reportPeriod";
import { computePlanUsage, resolvePlanUsageInput } from "@/lib/planUsage";
import { getBookingProgressIndex } from "@/lib/courseProgress";
import { toJSTDate } from "@/lib/timezone";

const at = (ymd: string) => toJSTDate(`${ymd}T12:00:00+09:00`);
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

type Plan = { plan_name: string; plan_type?: string; max_sessions?: number | null; grace_days?: number | null; cycle_months?: number | null; cycle_unit?: string | null; allow_overflow?: boolean | null; validity_days?: number | null };
const source = (start: string | null, plan: string, rows: string[], extra: Partial<ReportPeriodSource> & { plans?: Plan[] } = {}): ReportPeriodSource => ({
  planName: plan,
  cycleStartDate: start,
  tenantPlans: extra.plans ?? [],
  bookings: rows.map((d) => ({ booking_date: `${d}:00+09:00`, status: "予約済み" })),
  cycleStartPinned: extra.cycleStartPinned,
  graceEnabled: extra.graceEnabled,
});

/** 古い順に n 個（最後が「今回」） */
const periods = (s: ReportPeriodSource, now: Date, n: number): ReportPeriod[] => {
  const out: ReportPeriod[] = [];
  for (let k = 0; k > -n; k--) out.push(reportPeriodAt(s, k, now)!);
  return out.reverse();
};
const labels = (ps: ReportPeriod[]) => ps.map(reportPeriodLabel);

// 本番の実データ（日付だけ）
const START_A = "2026-10-06"; // 月4回・猶予OFF。1回目は 10/22（起算日より後）
const ROWS_A = ["2026-09-10T21:30", "2026-09-14T17:00", "2026-10-22T17:30", "2026-10-29T17:00", "2026-11-05T16:00", "2026-11-12T17:30"];
const START_ROLL = "2026-09-15"; // 月4回・猶予OFF。9/15 の区切りを 10/10 で使い切り、10/13 から次の区切り
const ROWS_ROLL = ["2026-08-19T13:15", "2026-08-26T13:15", "2026-09-02T13:15", "2026-09-10T13:15", "2026-09-15T13:00", "2026-09-23T13:00", "2026-10-01T13:00", "2026-10-10T13:00", "2026-10-13T13:15", "2026-10-19T12:00"];
const START_GRACE = "2026-08-07"; // 月8回・猶予7日。9/10 の区切りは 7回で終わり、10/11 が「8/8 前回分」、10/18 から次
const ROWS_GRACE = ["2026-06-29T19:45", "2026-07-03T19:45", "2026-07-08T20:00", "2026-07-14T20:15", "2026-07-17T19:15", "2026-07-24T19:15", "2026-07-26T10:00", "2026-08-02T12:00", "2026-08-03T19:15", "2026-08-07T19:15", "2026-08-09T10:00", "2026-08-19T18:45", "2026-08-23T19:00", "2026-08-25T19:15", "2026-08-31T21:30", "2026-09-04T19:30", "2026-09-07T21:30", "2026-09-10T19:30", "2026-09-12T21:15", "2026-09-16T18:15", "2026-09-18T19:15", "2026-09-25T20:45", "2026-09-29T19:15", "2026-10-04T10:00", "2026-10-11T11:15", "2026-10-18T11:30", "2026-10-20T20:15", "2026-10-24T13:30", "2026-10-27T19:15", "2026-11-01T11:30", "2026-11-03T19:15", "2026-11-07T12:30"];
const PLAN_GRACE: Plan = { plan_name: "月8回", plan_type: "subscription", max_sessions: 8, grace_days: 7 };
const START_GAP = "2026-05-18"; // 月4回・猶予OFF。6/23 から始まった区切り（6/23〜7/21 の4回）、7/27 から次。以後は予約なし
const ROWS_GAP = ["2026-04-22T17:45", "2026-05-18T18:00", "2026-06-02T18:30", "2026-06-09T18:30", "2026-06-16T18:30", "2026-06-23T18:30", "2026-06-30T18:30", "2026-07-07T18:30", "2026-07-21T18:30", "2026-07-27T18:00"];
const START_G7 = "2026-06-06"; // 月4回・猶予7日（使い切りと猶予の両方が出る）
const ROWS_G7 = ["2026-06-06T18:00", "2026-06-13T18:30", "2026-06-21T18:00", "2026-06-28T18:00", "2026-07-12T17:00", "2026-07-15T20:00", "2026-07-18T18:00", "2026-07-26T18:00", "2026-08-01T18:00", "2026-08-10T18:00", "2026-08-16T10:00", "2026-08-26T16:00", "2026-09-05T18:00", "2026-09-12T18:30", "2026-09-26T18:00", "2026-10-03T18:00", "2026-10-11T18:00", "2026-10-19T18:30", "2026-10-24T18:00", "2026-10-31T18:00"];
const PLAN_G7: Plan = { plan_name: "月4回", plan_type: "subscription", max_sessions: 4, grace_days: 7 };

describe("「今回」はカードの利用期間と同じ", () => {
  it("🔴 起算日 10/6・1回目 10/22 のお客様: 今回は 10/22〜11/22（カードと同じ）", () => {
    const s = source(START_A, "月4回", ROWS_A);
    const p = reportPeriodAt(s, 0, at("2026-11-15"))!;
    expect(reportPeriodLabel(p)).toBe("10/22〜11/22");
  });

  it("🔴 毎日の「今回」が、カード（computePlanUsage）の期間と一致する（実データ5人・9/1〜12/31）", () => {
    const cases: [ReportPeriodSource, Plan | null][] = [
      [source(START_A, "月4回", ROWS_A), null],
      [source(START_ROLL, "月4回", ROWS_ROLL), null],
      [source(START_GRACE, "月8回", ROWS_GRACE, { plans: [PLAN_GRACE] }), PLAN_GRACE],
      [source(START_GAP, "月4回", ROWS_GAP), null],
      [source(START_G7, "月4回", ROWS_G7, { plans: [PLAN_G7] }), PLAN_G7],
    ];
    let checked = 0;
    for (const [s, plan] of cases) {
      for (let d = at("2026-09-01"); d <= at("2026-12-31"); d = addDays(d, 1)) {
        const input = resolvePlanUsageInput(s.planName, plan, s.cycleStartDate, false)!;
        const usage = computePlanUsage(input, s.bookings, d);
        const p = reportPeriodAt(s, 0, d)!;
        expect(ymd(p.end)).toBe(ymd(usage.windowEnd!));
        if (usage.periodPending) {
          // 予約の無い今の区切りだけは、先頭の「前回分」の日を前の期間へ渡すので、開始が後ろにずれうる
          expect(p.start >= usage.windowStart!).toBe(true);
        } else {
          expect(ymd(p.start)).toBe(ymd(usage.windowStart!));
        }
        checked++;
      }
    }
    expect(checked).toBe(5 * 122);
  });
});

describe("前の期間: 隙間も重なりもなく、回数の区切り（チップ）と同じところで切れる", () => {
  /** 過去の期間の中の来店のチップが 1, 2, 3, … と1つずつ増える（＝期間がちょうど1つの区切り） */
  const expectChipsAligned = (s: ReportPeriodSource, now: Date, n: number) => {
    const ps = periods(s, now, n);
    const rows = s.bookings.map((b, i) => ({ id: `b${i}`, booking_date: b.booking_date, status: b.status }));
    const tenantPlan = s.tenantPlans.find((p) => p.plan_name === s.planName) ?? null;
    const input = resolvePlanUsageInput(s.planName, tenantPlan, s.cycleStartDate, false)!;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      expect(p.start < p.end).toBe(true);
      if (i + 1 < ps.length) expect(ymd(p.end)).toBe(ymd(ps[i + 1].start));
      if (p.end > startOfDay(now)) continue; // 今の期間は未来の予約を含みうるので対象外
      const inside = rows
        .filter((b) => { const d = toJSTDate(b.booking_date); return d >= p.start && d < p.end; })
        .map((b) => getBookingProgressIndex(b.id, s.cycleStartDate, s.planName, rows, input.cycleMonths, input.graceDays, input.cycleUnit, false))
        .filter((r): r is NonNullable<typeof r> => r != null && r.total != null);
      expect(inside.map((r) => r.index), `${reportPeriodLabel(p)}`).toEqual(inside.map((_, j) => j + 1));
    }
    return ps;
  };

  it("起算日 10/6・1回目 10/22: 10/22〜11/22 の前は、1回目の前日までの1ヶ月ずつ（起算日〜1回目の来店の無い日々も含める）", () => {
    const ps = expectChipsAligned(source(START_A, "月4回", ROWS_A), at("2026-11-15"), 4);
    expect(labels(ps)).toEqual(["7/22〜8/21", "8/22〜9/21", "9/22〜10/21", "10/22〜11/22"]);
  });

  it("🔴 使い切って次の区切りに移った来店（10/13）は、前の期間に入らない", () => {
    const ps = expectChipsAligned(source(START_ROLL, "月4回", ROWS_ROLL), at("2026-10-20"), 2);
    expect(labels(ps)).toEqual(["9/15〜10/12", "10/13〜11/13"]);
  });

  it("🔴 猶予で前回分に回した来店（10/11 = 8/8 前回分）は、前の期間に入る", () => {
    const s = source(START_GRACE, "月8回", ROWS_GRACE, { plans: [PLAN_GRACE] });
    const ps = expectChipsAligned(s, at("2026-10-25"), 4);
    // 9/10 の区切りは 10/11 の前回分（8/8）を含み、次の区切りの1回目 10/18 の前日まで
    expect(labels(ps)).toEqual(["7/7〜8/6", "8/7〜9/9", "9/10〜10/17", "10/18〜11/18"]);
  });

  it("🔴 区切りの間が数日空いただけなら前の期間に含める。1ヶ月以上空いたら、空いた月がそれぞれ1つの期間", () => {
    const s = source(START_GAP, "月4回", ROWS_GAP);
    const ps = expectChipsAligned(s, at("2026-10-15"), 7);
    expect(labels(ps)).toEqual([
      "3/18〜4/17", "4/18〜5/17", // 起算日より前
      "5/18〜6/22", // 5/18 の区切り（4回）＋ 6/23 の前日までの来店の無い4日
      "6/23〜7/26", // 6/23 の区切り（6/23, 6/30, 7/7, 7/21）＋ 7/27 の前日まで
      "7/27〜8/27", // 7/27 の区切り
      "8/28〜9/28", "9/29〜10/29", // 予約の無い月（今回はカードと同じく「1回目のご予約待ち」）
    ]);
  });

  it("使い切りと猶予が両方あるお客様でも、どの期間もチップの区切りと一致する（6/6〜）", () => {
    expectChipsAligned(source(START_G7, "月4回", ROWS_G7, { plans: [PLAN_G7] }), at("2026-11-20"), 8);
  });
});

describe("今の区切りが特別な形のとき", () => {
  it("今の区切りに予約が無い（1回目のご予約待ち）: 今日を含む区切り。カードと同じ", () => {
    const s = source(START_GAP, "月4回", ROWS_GAP);
    const now = at("2026-10-15");
    const p = reportPeriodAt(s, 0, now)!;
    expect(p.start <= startOfDay(now) && startOfDay(now) < p.end).toBe(true);
  });

  it("次の区切りの1回目が未来（10/22）: 今回はその区切り（カードと同じ「10/22から開始」）。今日はその前の期間に入る", () => {
    const rows = ["2026-09-10T21:30", "2026-09-14T17:00", "2026-10-22T17:30"];
    const s = source(START_A, "月4回", rows);
    const now = at("2026-10-15");
    expect(reportPeriodLabel(reportPeriodAt(s, 0, now)!)).toBe("10/22〜11/22");
    const prev = reportPeriodAt(s, -1, now)!;
    expect(prev.start <= startOfDay(now) && startOfDay(now) < prev.end).toBe(true);
  });

  it("猶予の前回分だけが今の区切りの先頭にある（10/12）: その日は前の期間。今回は翌日から", () => {
    const s = source(START_GRACE, "月8回", ROWS_GRACE.filter((d) => d < "2026-10-12"), { plans: [PLAN_GRACE] });
    const now = at("2026-10-13");
    const ps = periods(s, now, 2);
    expect(labels(ps)).toEqual(["9/10〜10/11", "10/12〜11/11"]);
  });
});

describe("店の設定どおりに区切るお客様（カードと同じく引き直さない）", () => {
  it("起算日固定（pinned）: 起算日からの暦どおり", () => {
    const s = source(START_A, "月4回", ROWS_A, { cycleStartPinned: true });
    expect(labels(periods(s, at("2026-11-15"), 2))).toEqual(["10/6〜11/6", "11/7〜12/7"]);
  });

  it("超過を許さないプラン（allow_overflow=false）: 起算日からの暦どおり", () => {
    const plan: Plan = { plan_name: "月4回", plan_type: "subscription", max_sessions: 4, allow_overflow: false };
    const s = source(START_A, "月4回", ROWS_A, { plans: [plan] });
    expect(labels(periods(s, at("2026-11-15"), 2))).toEqual(["10/6〜11/6", "11/7〜12/7"]);
  });

  it("週単位のプラン: 起算日より前も週の長さでさかのぼる", () => {
    const plan: Plan = { plan_name: "週1回", plan_type: "subscription", max_sessions: 1, cycle_months: 1, cycle_unit: "weeks" };
    const s = source("2026-10-05", "週1回", ["2026-10-05T10:00", "2026-10-12T10:00"], { plans: [plan] });
    const ps = periods(s, at("2026-10-14"), 3);
    expect(labels(ps)).toEqual(["9/28〜10/4", "10/5〜10/11", "10/12〜10/18"]);
  });
});

describe("対象外（呼び出し側の従来の期間を使う）", () => {
  it("回数券・期間プラン・起算日なし・プラン未設定・体験は null", () => {
    const now = at("2026-10-15");
    const ticket: Plan = { plan_name: "回数券10回", plan_type: "ticket", max_sessions: 10, validity_days: 90 };
    const period: Plan = { plan_name: "通い放題", plan_type: "period", max_sessions: null };
    expect(reportPeriodAt(source(START_A, "回数券10回", ROWS_A, { plans: [ticket] }), 0, now)).toBeNull();
    expect(reportPeriodAt(source(START_A, "通い放題", ROWS_A, { plans: [period] }), 0, now)).toBeNull();
    expect(reportPeriodAt(source(null, "月4回", ROWS_A), 0, now)).toBeNull();
    expect(reportPeriodAt(source(START_A, "プラン未設定", ROWS_A), 0, now)).toBeNull();
    expect(reportPeriodAt(source(START_A, "初回無料体験", ROWS_A), 0, now)).toBeNull();
    expect(reportPeriodAt(source(START_A, "ベーシック", ROWS_A), 0, now)).toBeNull();
  });

  it("キャンセル済みの予約は区切りに数えない（カードと同じ）", () => {
    const s = source(START_A, "月4回", ROWS_A);
    s.bookings[2] = { ...s.bookings[2], status: "キャンセル済み" }; // 10/22 を取り消し → 1回目は 10/29
    expect(reportPeriodLabel(reportPeriodAt(s, 0, at("2026-11-15"))!)).toBe("10/29〜11/29");
  });
});
