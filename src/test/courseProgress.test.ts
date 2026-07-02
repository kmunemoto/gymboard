import { describe, it, expect } from "vitest";
import {
  getMonthlySessionCount,
  getCycleWindow,
  computeCourseProgress,
  getBookingProgressIndex,
  resolveCycleMonths,
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
