import { describe, it, expect } from "vitest";
import {
  getMonthlySessionCount,
  getCycleWindow,
  computeCourseProgress,
  getBookingProgressIndex,
  resolveCycleMonths,
  resolveGraceDays,
  shouldRebaseCycleStart,
  type BookingForProgress,
} from "@/lib/courseProgress";
import { toJSTDate } from "@/lib/timezone";

const NOW = toJSTDate("2026-07-10T12:00:00+09:00"); // 2026-07-10 12:00 JST 固定

describe("getMonthlySessionCount", () => {
  it("月N回 / 通い放題 / 未対応 を判定", () => {
    expect(getMonthlySessionCount("月4回")).toBe(4);
    expect(getMonthlySessionCount("月3回")).toBe(3);
    expect(getMonthlySessionCount("通い放題")).toBe(-1);
    expect(getMonthlySessionCount("初回無料体験")).toBeNull();
    expect(getMonthlySessionCount("プラン未設定")).toBeNull();
    expect(getMonthlySessionCount(null)).toBeNull();
  });
});

describe("getCycleWindow", () => {
  it("起算日 6/20 のサイクルは 6/20〜7/21（応当日翌日が排他上限）", () => {
    const w = getCycleWindow("2026-06-20", NOW)!;
    expect(w).not.toBeNull();
    // start=6/20, end=7/21（= addMonths(6/20,1)=7/20 の翌日 00:00）
    expect(w.start.getMonth()).toBe(5); // June (0-indexed)
    expect(w.start.getDate()).toBe(20);
    expect(w.end.getMonth()).toBe(6); // July
    expect(w.end.getDate()).toBe(21);
  });

  it("cycleMonths=2 なら 6/20〜8/21（2ヶ月ごと・応当日翌日が排他上限）", () => {
    const w = getCycleWindow("2026-06-20", NOW, 2)!;
    expect(w.start.getMonth()).toBe(5); // June
    expect(w.start.getDate()).toBe(20);
    expect(w.end.getMonth()).toBe(7); // August（= addMonths(6/20,2)=8/20 の翌日）
    expect(w.end.getDate()).toBe(21);
  });

  it("cycleMonths 未指定は 1ヶ月扱い", () => {
    const a = getCycleWindow("2026-06-20", NOW)!;
    const b = getCycleWindow("2026-06-20", NOW, null)!;
    const c = getCycleWindow("2026-06-20", NOW, 1)!;
    expect(a.end.getTime()).toBe(b.end.getTime());
    expect(a.end.getTime()).toBe(c.end.getTime());
  });
});

describe("resolveCycleMonths", () => {
  const plans = [
    { plan_name: "月4回", cycle_months: null },
    { plan_name: "2ヶ月8回", cycle_months: 2 },
    { plan_name: "不正", cycle_months: 0 },
  ];
  it("プランの cycle_months を返し、null/0/未一致は1にフォールバック", () => {
    expect(resolveCycleMonths("2ヶ月8回", plans)).toBe(2);
    expect(resolveCycleMonths("月4回", plans)).toBe(1);
    expect(resolveCycleMonths("不正", plans)).toBe(1);
    expect(resolveCycleMonths("該当なし", plans)).toBe(1);
    expect(resolveCycleMonths(null, plans)).toBe(1);
    expect(resolveCycleMonths("月4回", null)).toBe(1);
  });
});

describe("computeCourseProgress", () => {
  const bookings: BookingForProgress[] = [
    { id: "a", booking_date: "2026-06-20T00:30:00+09:00", status: "予約済み" },
    { id: "b", booking_date: "2026-06-22T10:00:00+09:00", status: "予約済み" },
    { id: "c", booking_date: "2026-07-05T09:00:00+09:00", status: "予約済み" },
    { id: "d", booking_date: "2026-07-10T23:00:00+09:00", status: "予約済み" }, // now より後
    { id: "e", booking_date: "2026-07-21T09:00:00+09:00", status: "予約済み" }, // 次サイクル
    { id: "x", booking_date: "2026-07-06T10:00:00+09:00", status: "キャンセル済み" },
  ];

  it("今サイクルの実施済み/予約済み件数を端末TZに依存せず正しく数える", () => {
    const p = computeCourseProgress("2026-06-20", "月6回", bookings, NOW);
    expect(p.monthlyTotal).toBe(6);
    expect(p.totalUsed).toBe(4); // 6/20,6/22,7/05,7/10（7/21は次サイクル・キャンセル除外）
    expect(p.completedCount).toBe(3); // now(7/10 12:00)以前：6/20,6/22,7/05
    expect(p.upcomingCount).toBe(1); // 7/10 23:00
    expect(p.isUnlimited).toBe(false);
    expect(p.isUnconfigured).toBe(false);
  });

  it("通い放題は無制限", () => {
    const p = computeCourseProgress("2026-06-20", "通い放題", bookings, NOW);
    expect(p.isUnlimited).toBe(true);
    expect(p.monthlyTotal).toBe(-1);
  });
});

describe("getBookingProgressIndex", () => {
  const bookings: BookingForProgress[] = [
    { id: "a", booking_date: "2026-06-22T10:00:00+09:00", status: "予約済み" },
    { id: "b", booking_date: "2026-07-05T09:00:00+09:00", status: "予約済み" },
  ];

  it("対象予約が今サイクルの何回目かを返す", () => {
    const r = getBookingProgressIndex("b", "2026-06-20", "月6回", bookings);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(2);
    expect(r!.total).toBe(6);
  });
});

describe("shouldRebaseCycleStart（1回目の予約で起算日を自動設定してよいか）", () => {
  const mk = (dates: string[]): BookingForProgress[] =>
    dates.map((d, i) => ({ id: String(i), booking_date: `${d}T10:00:00+09:00`, status: "予約済み" }));

  it("起算日未設定（初回契約）は true", () => {
    expect(
      shouldRebaseCycleStart({ cycleStartDate: null, maxSessions: 6, bookingDateKey: "2026-07-10", existingBookings: [] }),
    ).toBe(true);
  });

  it("リセット直後（最初の窓・予約0件）は true", () => {
    // トレーナーが起算日を 7/2 にリセット → 1回目の予約 7/10 で起算日を 7/10 に補正してよい
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-07-02", maxSessions: 6, bookingDateKey: "2026-07-10", existingBookings: [] }),
    ).toBe(true);
  });

  it("今サイクルに既に予約があれば false（2回目以降）", () => {
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-07-02", maxSessions: 6, bookingDateKey: "2026-07-20", existingBookings: mk(["2026-07-10"]) }),
    ).toBe(false);
  });

  it("前サイクルを上限まで消化してロールした窓は true（きっちり消化→次のルーティン）", () => {
    // 起算日 6/2、前サイクル 6/2〜7/2 で6回消化済み → 7/10 の予約は次のルーティンの1回目
    const prev = mk(["2026-06-03", "2026-06-08", "2026-06-13", "2026-06-18", "2026-06-24", "2026-06-30"]);
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-02", maxSessions: 6, bookingDateKey: "2026-07-10", existingBookings: prev }),
    ).toBe(true);
  });

  it("前サイクル未消化のままロールした窓は false（大目に見た消化で誤発動しない）", () => {
    // 起算日 6/2、前サイクルは5回のみ消化 → 7/5 の「大目に見た6回目」で起算日を動かさない
    const prev = mk(["2026-06-03", "2026-06-08", "2026-06-13", "2026-06-18", "2026-06-24"]);
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-02", maxSessions: 6, bookingDateKey: "2026-07-05", existingBookings: prev }),
    ).toBe(false);
  });

  it("起算日より過去の日付への予約では動かさない", () => {
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-07-02", maxSessions: 6, bookingDateKey: "2026-06-28", existingBookings: [] }),
    ).toBe(false);
  });

  it("無制限プランはロール済み窓では動かさない（リセット直後のみ true）", () => {
    const prev = mk(["2026-06-10"]);
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-02", maxSessions: null, bookingDateKey: "2026-07-10", existingBookings: prev }),
    ).toBe(false);
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-07-02", maxSessions: null, bookingDateKey: "2026-07-10", existingBookings: [] }),
    ).toBe(true);
  });
});

describe("shouldRebaseCycleStart × 猶予（grace_days）", () => {
  const mk = (dates: string[]): BookingForProgress[] =>
    dates.map((d, i) => ({ id: String(i), booking_date: `${d}T10:00:00+09:00`, status: "予約済み" }));
  // 起算日 6/2・月6回。前サイクル[6/2,7/3)は5回のみ消化（残り1回）。
  const prev5 = mk(["2026-06-03", "2026-06-08", "2026-06-13", "2026-06-18", "2026-06-24"]);

  it("猶予帯の予約（前サイクルへ繰り入れ）では起算日を動かさない", () => {
    // 7/5 は猶予帯 [7/3,7/10)。前サイクルに空き(1)があるので大目に見た6回目 → 起算日据え置き
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-02", maxSessions: 6, graceDays: 7, bookingDateKey: "2026-07-05", existingBookings: prev5 }),
    ).toBe(false);
  });

  it("猶予で前サイクルが埋まった後の次の予約は起算日を動かす（次のルーティンの1回目）", () => {
    // 7/5 が繰入で前サイクル6回目 → 7/8 は次のルーティンの1回目
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-02", maxSessions: 6, graceDays: 7, bookingDateKey: "2026-07-08", existingBookings: [...prev5, ...mk(["2026-07-05"])] }),
    ).toBe(true);
  });

  it("猶予帯を過ぎた予約は繰り入れず、前サイクル未消化なら従来どおり動かさない", () => {
    // 7/12 は [7/3,7/10) の外。前サイクル未消化なので安全側で据え置き（graceDays=0 と一致）
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-02", maxSessions: 6, graceDays: 7, bookingDateKey: "2026-07-12", existingBookings: prev5 }),
    ).toBe(false);
  });

  it("graceDays 未指定は従来挙動（前サイクル未消化なら動かさない）", () => {
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-02", maxSessions: 6, bookingDateKey: "2026-07-05", existingBookings: prev5 }),
    ).toBe(false);
  });

  it("前サイクルを使い切っていれば猶予帯の予約でも次のルーティンの1回目として動かす", () => {
    const prev6 = [...prev5, ...mk(["2026-06-28"])];
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-02", maxSessions: 6, graceDays: 7, bookingDateKey: "2026-07-05", existingBookings: prev6 }),
    ).toBe(true);
  });
});

describe("resolveGraceDays × お客様ごとのON/OFF（grace_enabled）", () => {
  const plans = [{ plan_name: "月8回", grace_days: 7 }];
  it("既定（null/undefined/true）はプランの猶予日数を返す", () => {
    expect(resolveGraceDays("月8回", plans)).toBe(7);
    expect(resolveGraceDays("月8回", plans, null)).toBe(7);
    expect(resolveGraceDays("月8回", plans, true)).toBe(7);
  });
  it("false のお客様には適用しない（0）", () => {
    expect(resolveGraceDays("月8回", plans, false)).toBe(0);
  });
});

describe("getBookingProgressIndex × 猶予（大目に見た回は前サイクルの回数として表示）", () => {
  // 長尾さんのケース: 起算日 6/4・月8回・期限 7/4。7回消化済みで、期限翌日 7/5 に8回目。
  const mk = (dates: string[]): BookingForProgress[] =>
    dates.map((d, i) => ({ id: `${d}-${i}`, booking_date: `${d}T10:00:00+09:00`, status: "予約済み" }));
  const seven = mk([
    "2026-06-06", "2026-06-10", "2026-06-14", "2026-06-18",
    "2026-06-24", "2026-06-29", "2026-07-02",
  ]);
  const graceBooking: BookingForProgress = { id: "grace-1", booking_date: "2026-07-05T12:45:00+09:00", status: "予約済み" };

  it("猶予帯の予約は「8/8」（前サイクルの続き）として数える", () => {
    const r = getBookingProgressIndex("grace-1", "2026-06-04", "月8回", [...seven, graceBooking], 1, 7);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(8);
    expect(r!.total).toBe(8);
  });

  it("猶予未設定なら従来どおり新ルーティンの1回目（1/8）", () => {
    const r = getBookingProgressIndex("grace-1", "2026-06-04", "月8回", [...seven, graceBooking], 1);
    expect(r!.index).toBe(1);
  });

  it("繰入で前サイクルが埋まった後の予約は新ルーティンの1回目（1/8）", () => {
    // 7/5 が繰入で8回目 → 7/8 の予約は次のルーティンの1回目
    const next: BookingForProgress = { id: "next-1", booking_date: "2026-07-08T10:00:00+09:00", status: "予約済み" };
    const r = getBookingProgressIndex("next-1", "2026-06-04", "月8回", [...seven, graceBooking, next], 1, 7);
    expect(r!.index).toBe(1);
    expect(r!.total).toBe(8);
  });

  it("前サイクルを使い切っていれば猶予帯でも繰り入れず 1/8", () => {
    const eight = mk([
      "2026-06-06", "2026-06-10", "2026-06-14", "2026-06-18",
      "2026-06-24", "2026-06-27", "2026-06-29", "2026-07-02",
    ]);
    const r = getBookingProgressIndex("grace-1", "2026-06-04", "月8回", [...eight, graceBooking], 1, 7);
    expect(r!.index).toBe(1);
  });
});

describe("shouldRebaseCycleStart × 回数使い切り後の期限内予約（期限の終わりを待たない）", () => {
  const mk = (dates: string[]): BookingForProgress[] =>
    dates.map((d, i) => ({ id: `${d}-${i}`, booking_date: `${d}T10:00:00+09:00`, status: "予約済み" }));
  // 起算日 6/5・月8回。8回を期限（7/5）前の 6/25 までに消化。
  const eight = mk([
    "2026-06-06", "2026-06-08", "2026-06-10", "2026-06-12",
    "2026-06-15", "2026-06-18", "2026-06-21", "2026-06-25",
  ]);

  it("使い切った後の期限内予約（9回目）は新ルーティンの1回目として true", () => {
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-05", maxSessions: 8, bookingDateKey: "2026-06-28", existingBookings: eight }),
    ).toBe(true);
  });

  it("まだ使い切っていなければ false（8回目は同じルーティン）", () => {
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-05", maxSessions: 8, bookingDateKey: "2026-06-28", existingBookings: eight.slice(0, 7) }),
    ).toBe(false);
  });

  it("ロール後の窓での2件目は false（新ルーティンの2回目）", () => {
    // 9件目(6/28)で新ルーティン開始済み → 7/2 の予約は新ルーティンの2回目
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-05", maxSessions: 8, bookingDateKey: "2026-07-02", existingBookings: [...eight, ...mk(["2026-06-28"])] }),
    ).toBe(false);
  });

  it("ロール後の窓も使い切ったら、次の予約でまた true（連続ロール）", () => {
    const second = mk([
      "2026-06-28", "2026-06-30", "2026-07-02", "2026-07-04",
      "2026-07-07", "2026-07-09", "2026-07-11", "2026-07-14",
    ]);
    expect(
      shouldRebaseCycleStart({ cycleStartDate: "2026-06-05", maxSessions: 8, bookingDateKey: "2026-07-16", existingBookings: [...eight, ...second] }),
    ).toBe(true);
  });
});
