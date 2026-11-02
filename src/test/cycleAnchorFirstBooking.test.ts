/**
 * 利用期間は「今のプランの予約の1回目」から自動で数える。手で入れた起算日はいちばん下（2026-11-02）。
 *
 * 宗本さん（予定表とお客様詳細のスクリーンショット）:
 * > 利用期間の計算の仕方さ、予約の1回目を最優先に考えて自動で。
 * > 利用期間を手動で設定するやつの優先順位は一番下分かる？
 * > 手動で決められる利用期間を優先に利用期間を決めないで
 *
 * 本番の実データ（日付と予約の種類だけ。名前は持たない）: 月4回・猶予OFF・固定なし。
 * 月6回の予約 8/19〜9/28 のあと、月4回の予約 10/4, 10/18, 11/2, 11/9, 11/15, 11/19。
 * お客様詳細の「今日にリセット」で起算日が 11/2 になり、予定表の 11/2 が「1/4」、カードが
 * 「予約済み 4/4」と出ていた（正しくは 10/4〜11/4 の 3/4）。保存された起算日より前の予約は
 * どの区切りにも入らないので、10/4 から始まっていた区切りが途中で切られていた。
 *
 * 🔴 壊しやすいもの:
 *   1. 画面のどれかが予約の種類（booking_type）を落として渡す
 *      → その画面だけ保存された起算日で数え、ほかの画面と食い違う
 *   2. 前のプランの予約を今のプランの回数に混ぜる（プランを変えたお客様）
 *   3. 起算日の固定（店が明示的に決めたもの。2026-08-22）まで上書きする
 *   4. 予約したときの自動設定（shouldRebaseCycleStart）が、別の種類で入れた代理予約まで
 *      「今のプランの1回目」とみなして起算日を書き換える
 *   5. サーバー側の写し（期限のお知らせ）だけ保存された起算日のまま
 *   6. 予約の種類にプラン名を入れていない店（「通常」など）の数え方が変わる
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  getBookingProgressIndex,
  getNextBookingOrdinal,
  resolveCycleAnchor,
  shouldRebaseCycleStart,
  type BookingForProgress,
} from "@/lib/courseProgress";
import {
  computePlanUsage,
  resolvePlanUsageInput,
  toPlanUsageBooking,
  toProgressBooking,
  type PlanUsageBooking,
  type PlanUsageInput,
} from "@/lib/planUsage";
import { calendarPeriods } from "@/lib/calendarPeriod";
import { reportPeriodAt, type ReportPeriodSource } from "@/lib/reportPeriod";
import { computeSubscriptionUsage, isoToJstYmd, resolveCycleAnchorYmd } from "../../supabase/functions/_shared/cycle";
import { toJSTDate } from "@/lib/timezone";
import { addDays, format } from "date-fns";

const OLD = "月6回";
const PLAN = "月4回";
/** 「今日にリセット」で入った日付（手で入れた起算日） */
const SAVED = "2026-11-02";
/** スクリーンショットの時刻 */
const NOW = toJSTDate("2026-11-02T17:30:00+09:00");

type Row = [date: string, time: string, type: string | null, status?: string];
const REAL_ROWS: Row[] = [
  ["2026-08-19", "16:00", OLD], ["2026-08-25", "16:00", OLD], ["2026-08-31", "16:00", OLD],
  ["2026-09-09", "16:00", OLD], ["2026-09-17", "16:00", OLD], ["2026-09-28", "16:00", OLD],
  ["2026-10-04", "16:15", PLAN], ["2026-10-18", "10:15", PLAN], ["2026-11-02", "16:00", PLAN],
  ["2026-11-09", "11:15", PLAN], ["2026-11-15", "10:15", PLAN], ["2026-11-19", "10:15", PLAN],
];

/** 画面の予約（useMyBookings / useAllBookings の形） */
const screenRows = (rows: Row[]) =>
  rows.map(([date, startTime, booking_type, status], i) => ({
    id: `b${i}-${date}`, date, startTime, status: status ?? "予約済み", booking_type,
  }));

const REAL = screenRows(REAL_ROWS);
const USAGE: PlanUsageBooking[] = REAL.map(toPlanUsageBooking);
const PROGRESS: BookingForProgress[] = REAL.map(toProgressBooking);

const TENANT_PLAN = { plan_name: PLAN, plan_type: "subscription", max_sessions: 4, grace_days: 7, allow_overflow: true };
/** カードと同じ材料。このお客様は猶予OFF（grace_enabled=false） */
const input = (over: Partial<PlanUsageInput> = {}): PlanUsageInput => ({
  ...resolvePlanUsageInput(PLAN, TENANT_PLAN, SAVED, false)!,
  graceDays: 0,
  ...over,
});
const md = (d: Date | null | undefined) => (d ? format(d, "MM-dd") : null);
const lastDay = (end: Date | null | undefined) => (end ? format(addDays(end, -1), "MM-dd") : null);

const chip = (bookings: BookingForProgress[], date: string, opts: { saved?: string; pinned?: boolean } = {}) => {
  const b = bookings.find((x) => x.booking_date.startsWith(date))!;
  const r = getBookingProgressIndex(b.id, opts.saved ?? SAVED, PLAN, bookings, 1, 0, "months", opts.pinned ?? false);
  return r ? `${r.index}/${r.total}` : null;
};

describe("resolveCycleAnchor: 鎖の先頭は今のプランの予約の1回目", () => {
  const anchor = (rows: Row[], over: { saved?: string | null; plan?: string | null; pinned?: boolean; allowOverflow?: boolean } = {}) =>
    resolveCycleAnchor({
      cycleStartDate: over.saved === undefined ? SAVED : over.saved,
      planName: over.plan === undefined ? PLAN : over.plan,
      bookings: screenRows(rows).map(toPlanUsageBooking),
      pinned: over.pinned,
      allowOverflow: over.allowOverflow,
    });

  it("本番の実データ: 手で入れた 11/2 ではなく、月4回の1回目の 10/4", () => {
    expect(anchor(REAL_ROWS)).toBe("2026-10-04");
  });

  it("起算日を固定しているお客様は、保存された起算日（店が明示的に決めたもの）", () => {
    expect(anchor(REAL_ROWS, { pinned: true })).toBe(SAVED);
  });

  it("超過を許さないプランは、保存された起算日（DB の GB004 がその暦窓で数えて断るので揃える）", () => {
    expect(anchor(REAL_ROWS, { allowOverflow: false })).toBe(SAVED);
  });

  it("今のプランの予約がまだ無い（いちばん新しい予約が前のプラン）→ 保存された起算日", () => {
    expect(anchor(REAL_ROWS.slice(0, 6))).toBe(SAVED);
    expect(anchor([...REAL_ROWS, ["2026-11-25", "10:00", OLD]])).toBe(SAVED);
  });

  it("予約が1件も無い → 保存された起算日。どちらも無ければ null", () => {
    expect(anchor([])).toBe(SAVED);
    expect(anchor([], { saved: null })).toBeNull();
  });

  it("保存された起算日が無くても、今のプランの予約があればそこから数える", () => {
    expect(anchor(REAL_ROWS, { saved: null })).toBe("2026-10-04");
  });

  it("A→B→A と戻ったら、いちばん新しい並びの1回目（前の並びの回数は混ぜない）", () => {
    expect(anchor([
      ["2026-07-01", "10:00", PLAN], ["2026-07-08", "10:00", PLAN],
      ["2026-08-01", "10:00", OLD], ["2026-08-08", "10:00", OLD],
      ["2026-09-03", "10:00", PLAN], ["2026-09-10", "10:00", PLAN],
    ])).toBe("2026-09-03");
  });

  it("キャンセル済みは並びに入れない・切らない。同日キャンセル（消化）は1回として入れる", () => {
    expect(anchor([
      ["2026-09-28", "16:00", OLD],
      ["2026-10-01", "10:00", PLAN, "キャンセル済み"],
      ["2026-10-04", "16:15", PLAN],
      ["2026-10-10", "10:00", OLD, "キャンセル済み"],
      ["2026-10-18", "10:15", PLAN],
    ])).toBe("2026-10-04");
    expect(anchor([
      ["2026-09-28", "16:00", OLD],
      ["2026-10-01", "10:00", PLAN, "同日キャンセル済み"],
      ["2026-10-04", "16:15", PLAN],
    ])).toBe("2026-10-01");
  });

  it("並べる順番は日時（渡された順ではない）", () => {
    const rows: Row[] = [["2026-11-02", "16:00", PLAN], ["2026-09-28", "16:00", OLD], ["2026-10-04", "16:15", PLAN]];
    expect(anchor(rows)).toBe("2026-10-04");
  });

  it("日付は日本時間で決める（0:30 の予約は、UTC では前の日）", () => {
    expect(anchor([["2026-09-28", "16:00", OLD], ["2026-10-04", "00:30", PLAN]])).toBe("2026-10-04");
  });

  it("プラン名が無い・予約の種類を渡していない → 保存された起算日（従来どおり）", () => {
    expect(anchor(REAL_ROWS, { plan: null })).toBe(SAVED);
    const untyped = REAL.map(({ date, startTime, status }) => toPlanUsageBooking({ date, startTime, status }));
    expect(resolveCycleAnchor({ cycleStartDate: SAVED, planName: PLAN, bookings: untyped })).toBe(SAVED);
  });

  it("予約の種類にプラン名を入れていない店（「通常」）は、保存された起算日のまま（数え方を変えない）", () => {
    const rows: Row[] = [["2026-10-01", "10:00", "通常"], ["2026-10-08", "10:00", "通常"], ["2026-10-15", "10:00", "通常"]];
    expect(anchor(rows, { saved: "2026-09-20" })).toBe("2026-09-20");
  });
});

describe("本番の実データ（スクリーンショットのお客様）: どの画面も 10/4〜11/4 の 3/4", () => {
  it("カード: 利用期間 10/4〜11/4・予約済み 3/4・あと1回", () => {
    const u = computePlanUsage(input(), USAGE, NOW);
    expect(md(u.windowStart)).toBe("10-04");
    expect(lastDay(u.windowEnd)).toBe("11-04");
    expect(u.used).toBe(3);
    expect(u.remaining).toBe(1);
    expect(u.periodPending).toBe(false);
  });

  it("（直す前）予約の種類が無いと、手で入れた 11/2 から数えて 4/4 になる", () => {
    const untyped = USAGE.map(({ booking_date, status }) => ({ booking_date, status }));
    const u = computePlanUsage(input(), untyped, NOW);
    expect(md(u.windowStart)).toBe("11-02");
    expect(u.used).toBe(4);
  });

  it("予定表のチップ: 11/2 は 3/4。11/9 から次の区切りの 1/4", () => {
    expect(chip(PROGRESS, "2026-10-04")).toBe("1/4");
    expect(chip(PROGRESS, "2026-10-18")).toBe("2/4");
    expect(chip(PROGRESS, "2026-11-02")).toBe("3/4");
    expect(chip(PROGRESS, "2026-11-09")).toBe("1/4");
    expect(chip(PROGRESS, "2026-11-15")).toBe("2/4");
    expect(chip(PROGRESS, "2026-11-19")).toBe("3/4");
  });

  it("前のプラン（月6回）の予約には、今のプランの回数を付けない", () => {
    expect(chip(PROGRESS, "2026-09-28")).toBeNull();
    expect(chip(PROGRESS, "2026-08-19")).toBeNull();
  });

  it("手で入れた日付をどこに動かしても、固定していなければ結果は同じ（いちばん下）", () => {
    for (const saved of ["2026-11-02", "2026-11-20", "2026-08-01", "2026-10-10"]) {
      const u = computePlanUsage(input({ startDate: saved }), USAGE, NOW);
      expect([md(u.windowStart), lastDay(u.windowEnd), u.used]).toEqual(["10-04", "11-04", 3]);
      expect(chip(PROGRESS, "2026-11-02", { saved })).toBe("3/4");
    }
  });

  it("固定をオンにしたら、手で入れた日付が最優先（従来どおり）", () => {
    const u = computePlanUsage(input({ cycleStartPinned: true }), USAGE, NOW);
    expect(md(u.windowStart)).toBe("11-02");
    expect(chip(PROGRESS, "2026-11-02", { pinned: true })).toBe("1/4");
  });

  it("ホームの「次回の予約・今回 n/4回目」: 11/9 は 1回目", () => {
    const next = PROGRESS.find((b) => b.booking_date.startsWith("2026-11-09"))!;
    expect(getNextBookingOrdinal({
      bookingId: next.id, cycleStartDate: SAVED, plan: PLAN, maxSessions: 4, bookings: PROGRESS,
      cycleMonths: 1, graceDays: 0, cycleUnit: "months", pinned: false,
    })).toBe(1);
  });

  it("予約カレンダーの帯: 今回 10/4〜11/4、次の期間 11/9〜", () => {
    const view = calendarPeriods(input(), USAGE, NOW)!;
    expect([md(view.current?.start), lastDay(view.current?.end)]).toEqual(["10-04", "11-04"]);
    expect(md(view.next?.start)).toBe("11-09");
    expect(view.remaining).toBe(1);
  });

  it("レポートの期間（月次レポート・部位バランス・ホーム）もカードと同じ 10/4〜11/4", () => {
    const source: ReportPeriodSource = {
      planName: PLAN, cycleStartDate: SAVED, cycleStartPinned: false, graceEnabled: false,
      tenantPlans: [TENANT_PLAN], bookings: USAGE,
    };
    const p = reportPeriodAt(source, 0, NOW)!;
    expect([md(p.start), lastDay(p.end)]).toEqual(["10-04", "11-04"]);
  });

  it("保存された起算日が無くても（自動設定の前）、今のプランの予約があれば数える", () => {
    const u = computePlanUsage(input({ startDate: null }), USAGE, NOW);
    expect([md(u.windowStart), u.used]).toEqual(["10-04", 3]);
    expect(calendarPeriods(input({ startDate: null }), USAGE, NOW)?.current).not.toBeNull();
  });
});

describe("予約したときの起算日の自動設定（shouldRebaseCycleStart）も同じ先頭から判定する", () => {
  const existing = (rows: Row[]): BookingForProgress[] => screenRows(rows).map(toProgressBooking);
  const OLD_ONLY = REAL_ROWS.slice(0, 6);
  const rebase = (over: { saved?: string; rows?: Row[]; date: string; bookingType?: string | null; planName?: string | null }) =>
    shouldRebaseCycleStart({
      cycleStartDate: over.saved ?? "2026-08-19",
      maxSessions: 4,
      cycleMonths: 1,
      cycleUnit: "months",
      graceDays: 0,
      bookingDateKey: over.date,
      existingBookings: existing(over.rows ?? OLD_ONLY),
      planName: over.planName === undefined ? PLAN : over.planName,
      bookingType: over.bookingType,
    });

  it("プランを変えて最初の予約（今のプランの1回目）→ その日を起算日に", () => {
    expect(rebase({ date: "2026-10-04", bookingType: PLAN })).toBe(true);
  });

  it("（従来）プラン名を渡さないと、前のプランの予約と同じ区切りの途中とみなして動かさない", () => {
    expect(rebase({ date: "2026-10-04", bookingType: PLAN, planName: null })).toBe(false);
  });

  it("🔴 別の種類で入れた代理予約は、今のプランの1回目とみなさない（起算日を書き換えない）", () => {
    expect(rebase({ date: "2026-10-04", bookingType: OLD })).toBe(false);
    expect(rebase({ date: "2026-10-04", bookingType: "プラン未設定" })).toBe(false);
  });

  it("予約の種類を渡さない呼び出しは、鎖に入れない（従来どおりの判定）", () => {
    expect(rebase({ date: "2026-10-04" })).toBe(false);
  });

  it("並びの途中の予約では動かさない（表示と同じ 10/4 起点で、まだ区切りの途中）", () => {
    expect(rebase({
      saved: "2026-10-04", date: "2026-11-02", bookingType: PLAN,
      rows: REAL_ROWS.slice(0, 8),
    })).toBe(false);
  });

  it("手で後ろへずらした起算日（11/2）でも、10/4 からの区切りを使い切っていれば次の1回目で動く", () => {
    // 10/4, 10/18, 10/25, 11/1 で使い切り → 11/3 は次の区切りの1回目（期限 11/4 の前でも）
    const rows: Row[] = [...OLD_ONLY, ["2026-10-04", "16:15", PLAN], ["2026-10-18", "10:15", PLAN], ["2026-10-25", "10:15", PLAN], ["2026-11-01", "10:15", PLAN]];
    expect(rebase({ saved: "2026-11-02", rows, date: "2026-11-03", bookingType: PLAN })).toBe(true);
  });
});

describe("サーバー側の写し（期限のお知らせ・_shared/cycle.ts）が画面と同じ先頭・同じ結果", () => {
  const port = (rows: Row[], o: { saved: string | null; pinned?: boolean; allowOverflow?: boolean; graceDays?: number; nowYmd: string }) => {
    const active = screenRows(rows).filter((b) => b.status !== "キャンセル済み").map(toPlanUsageBooking);
    const startYmd = resolveCycleAnchorYmd({
      savedYmd: o.saved,
      planName: PLAN,
      bookings: active.map((b) => ({ iso: b.booking_date, type: b.booking_type ?? null })),
      pinned: o.pinned,
      allowOverflow: o.allowOverflow,
    });
    return {
      startYmd,
      usage: startYmd
        ? computeSubscriptionUsage({
            startYmd, maxSessions: 4, cycleMonths: null, cycleUnit: null, graceDays: o.graceDays ?? 0,
            bookingIsos: active.map((b) => b.booking_date), nowJstYmd: o.nowYmd,
            anchorToFirstBooking: true, pinned: o.pinned,
          })
        : null,
    };
  };

  const cases: { name: string; rows: Row[]; saved: string | null; pinned?: boolean; allowOverflow?: boolean; graceDays?: number; now: string }[] = [
    { name: "本番の実データ（11/2）", rows: REAL_ROWS, saved: SAVED, now: "2026-11-02" },
    { name: "本番の実データ（11/12・次の区切り）", rows: REAL_ROWS, saved: SAVED, now: "2026-11-12" },
    { name: "固定中", rows: REAL_ROWS, saved: SAVED, pinned: true, now: "2026-11-12" },
    { name: "超過を許さないプラン", rows: REAL_ROWS, saved: SAVED, allowOverflow: false, now: "2026-11-12" },
    { name: "今のプランの予約がまだ無い", rows: REAL_ROWS.slice(0, 6), saved: "2026-10-30", now: "2026-11-02" },
    { name: "起算日なし・予約あり", rows: REAL_ROWS, saved: null, now: "2026-11-02" },
    { name: "A→B→A", rows: [["2026-07-01", "10:00", PLAN], ["2026-08-01", "10:00", OLD], ["2026-09-03", "10:00", PLAN], ["2026-09-10", "10:00", PLAN]], saved: "2026-07-01", now: "2026-09-20" },
    { name: "日付の境目（0:30）", rows: [["2026-09-28", "16:00", OLD], ["2026-10-04", "00:30", PLAN], ["2026-10-11", "23:30", PLAN]], saved: SAVED, now: "2026-10-20" },
    {
      name: "猶予7日（前の区切りへ回す）",
      rows: [["2026-09-28", "16:00", OLD], ["2026-10-04", "10:00", PLAN], ["2026-10-11", "10:00", PLAN], ["2026-10-25", "10:00", PLAN], ["2026-11-07", "10:00", PLAN], ["2026-11-12", "10:00", PLAN]],
      saved: "2026-11-05", graceDays: 7, now: "2026-11-10",
    },
    { name: "キャンセル済みを挟む", rows: [["2026-09-28", "16:00", OLD], ["2026-10-04", "16:15", PLAN], ["2026-10-10", "10:00", OLD, "キャンセル済み"], ["2026-10-18", "10:15", PLAN]], saved: SAVED, now: "2026-10-20" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const typed = screenRows(c.rows).map(toPlanUsageBooking);
      const clientInput = input({
        startDate: c.saved, cycleStartPinned: c.pinned ?? false,
        allowOverflow: c.allowOverflow ?? true, graceDays: c.graceDays ?? 0,
      });
      const p = port(c.rows, { saved: c.saved, pinned: c.pinned, allowOverflow: c.allowOverflow, graceDays: c.graceDays, nowYmd: c.now });
      // 先頭が同じ
      const clientStart = resolveCycleAnchor({
        cycleStartDate: c.saved, planName: PLAN, bookings: typed,
        pinned: c.pinned, allowOverflow: c.allowOverflow,
      });
      expect(p.startYmd).toBe(clientStart);
      // 残り回数・期限が同じ
      const client = computePlanUsage(clientInput, typed, toJSTDate(`${c.now}T12:00:00+09:00`));
      expect(p.usage?.remaining ?? null).toBe(client.remaining);
      expect(p.usage?.periodPending ?? null).toBe(client.periodPending);
      const portLast = p.usage ? isoToJstYmd(new Date(p.usage.windowEnd - 86400000).toISOString()) : null;
      const clientLast = client.windowEnd ? format(addDays(client.windowEnd, -1), "yyyy-MM-dd") : null;
      expect(portLast).toBe(clientLast);
    });
  }
});

describe("予約の種類（booking_type）を、どの画面もサーバーも落とさずに渡している", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it.each([
    "src/components/trainer/TrainerSchedule.tsx",
    "src/components/trainer/TrainerDashboard.tsx",
    "src/components/trainer/WeekTimelineView.tsx",
  ])("%s（予定表・ダッシュボードのチップと回数）", (p) => {
    expect(src(p)).toMatch(
      /booking_date: `\$\{b\.date\}T\$\{b\.startTime\}:00\+09:00`,\s*status: b\.status,[\s\S]{0,200}?booking_type: b\.booking_type \?\? null/,
    );
  });

  it("お客様詳細（カード・期限・部位バランス）は toUsageBooking を通す", () => {
    const s = src("src/components/trainer/TrainerClientDetail.tsx");
    expect(s).toMatch(/const toUsageBooking = [\s\S]{0,200}?booking_type: b\.booking_type \?\? null/);
    expect((s.match(/\.map\(toUsageBooking\)/g) ?? []).length).toBe(3);
    expect(s).not.toMatch(/\(\{ booking_date: b\.date, status: b\.status \}\)/);
  });

  it("お客様の予約画面（カード・カレンダー・チップ）", () => {
    const s = src("src/components/customer/CustomerBooking.tsx");
    expect(s).toMatch(/myBookings\.map\(toPlanUsageBooking\)/);
    expect(s).toMatch(/myBookings\.map\(toProgressBooking\)/);
    expect(s).toMatch(/useCalendarPeriod\(planUsageInput, planBookingsForUsage,/);
  });

  it.each([
    "src/components/customer/CustomerHome.tsx",
    "src/components/customer/MuscleBalanceRadar.tsx",
    "src/components/customer/CustomerMonthlyReport.tsx",
  ])("%s", (p) => {
    const s = src(p);
    expect(s).toMatch(/\.map\(toPlanUsageBooking\)/);
    // 素の { booking_date, status } に組み直していない
    expect(s).not.toMatch(/booking_date: `\$\{b\.date\}T\$\{b\.startTime\}:00\+09:00`, status: b\.status \}/);
  });

  it("ホームの「今回 n/m回目」も種類付きで数える", () => {
    expect(src("src/components/customer/CustomerHome.tsx")).toMatch(/bookings: bookings\.map\(toProgressBooking\)/);
  });

  it("予約したときの自動設定: 種類を読み、今のプラン名と新しい予約の種類を渡す", () => {
    const s = src("src/hooks/useBookings.ts");
    expect(s).toMatch(/\.select\("booking_date, status, booking_type"\)/);
    expect(s).toMatch(/planName: prof\.plan,\s*bookingType,/);
    expect(s).toMatch(/rebaseCycleStartIfNeeded\(userId, date, data\.id, bookingType\)/);
  });

  it("期限のお知らせ（push-period-reminder）: 種類を読み、同じ先頭から数え、1000行で切らない", () => {
    const s = src("supabase/functions/push-period-reminder/index.ts");
    expect(s).toMatch(/from\("bookings"\)\.select\("[^"]*booking_type[^"]*"\)/);
    expect(s).toMatch(/resolveCycleAnchorYmd\(\{/);
    expect(s).toMatch(/allow_overflow/);
    expect(s).toMatch(/\.range\(from, to\)/);
    expect(s).toMatch(/\.order\("booking_date"/);
  });
});
