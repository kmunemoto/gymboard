/**
 * 「利用期間」を1回目の日に引き直したら、「予約済み n/N」もその期間で数える（2026-09-24）。
 *
 * 宗本さん（顧客詳細のスクリーンショットを添えて）「これカウントの仕方おかしい」。
 *
 * 起算日 9/17・月4回・予約 10/3, 10/10, 10/24 のお客様で、カードは
 * 「利用期間 10/3〜11/3」なのに「予約済み 2/4・2回予約可能」と出ていた。
 * 期間だけ1回目（10/3）に引き直し、回数は元の暦窓 [9/17, 10/18) で数えていたため、
 * 表示している期間の中にある 10/24 が数えられていなかった。
 *
 * 日付は本番の実データ（名前は持たない）。
 */
import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import { computePlanUsage } from "@/lib/planUsage";
import { getBookingProgressIndex } from "@/lib/courseProgress";
import { toJSTDate } from "@/lib/timezone";

const at = (ymd: string) => toJSTDate(`${ymd}T23:40:00+09:00`);
const bookings = (dates: string[]) =>
  dates.map((d, i) => ({ id: String(i), booking_date: `${d}T11:00:00+09:00`, status: "予約済み" }));
const lastDay = (end: Date | null) => (end ? format(new Date(end.getTime() - 86400000), "M/d") : "-");

const MONTHLY4 = { planType: "subscription", maxSessions: 4, validityDays: null, cycleMonths: null, cycleUnit: null } as const;

describe("🔴 引き直した期間で回数を数える", () => {
  it("起算日 9/17・予約 10/3, 10/10, 10/24 → 10/3〜11/3 で 3/4・残り1（以前は 2/4・残り2）", () => {
    const u = computePlanUsage(
      { ...MONTHLY4, startDate: "2026-09-17", graceDays: 0 },
      bookings(["2026-10-03", "2026-10-10", "2026-10-24"]),
      at("2026-09-24"),
    );
    expect(format(u.windowStart!, "M/d")).toBe("10/3");
    expect(lastDay(u.windowEnd)).toBe("11/3");
    expect(u.used).toBe(3);
    expect(u.remaining).toBe(1);
    expect(u.notStarted).toBe(true);
  });

  it("期間の途中から見ても同じ（10/12 時点でも 10/3〜11/3・3/4）", () => {
    const u = computePlanUsage(
      { ...MONTHLY4, startDate: "2026-09-17", graceDays: 0 },
      bookings(["2026-10-03", "2026-10-10", "2026-10-24"]),
      at("2026-10-12"),
    );
    expect(format(u.windowStart!, "M/d")).toBe("10/3");
    expect(u.used).toBe(3);
    expect(u.remaining).toBe(1);
  });

  it("古い起算日（6/6）のまま・引き直した 9/5〜10/5 に4件 → 4/4（以前は 3/4）。予約チップ 1〜4 と揃う", () => {
    const dates = [
      "2026-06-06", "2026-06-13", "2026-06-21", "2026-06-28", "2026-07-12",
      "2026-07-15", "2026-07-18", "2026-07-26", "2026-08-01", "2026-08-10", "2026-08-16", "2026-08-26",
      "2026-09-05", "2026-09-12", "2026-09-26", "2026-10-03", "2026-10-11", "2026-10-24",
    ];
    const bs = bookings(dates);
    const u = computePlanUsage({ ...MONTHLY4, startDate: "2026-06-06", graceDays: 7 }, bs, at("2026-09-24"));
    expect(format(u.windowStart!, "M/d")).toBe("9/5");
    expect(lastDay(u.windowEnd)).toBe("10/5");
    expect(u.used).toBe(4);
    expect(u.consumed).toBe(true);

    // 予定表のチップ（今回 n/4 回目）も、この期間の4件を 1〜4 と数えている
    const chips = ["2026-09-05", "2026-09-12", "2026-09-26", "2026-10-03"].map(
      (d) => getBookingProgressIndex(String(dates.indexOf(d)), "2026-06-06", "月4回", bs, null, 7, null)?.index,
    );
    expect(chips).toEqual([1, 2, 3, 4]);
  });

  it("起算日を1回目の日（10/3）に合わせれば、カードと予約チップが揃う（10/24 は 3/4）", () => {
    const bs = bookings(["2026-10-03", "2026-10-10", "2026-10-24"]);
    const u = computePlanUsage({ ...MONTHLY4, startDate: "2026-10-03", graceDays: 0 }, bs, at("2026-09-24"));
    expect(u.used).toBe(3);
    const chips = bs.map((b) => getBookingProgressIndex(b.id, "2026-10-03", "月4回", bs, null, 0, null)?.index);
    expect(chips).toEqual([1, 2, 3]);
  });
});

describe("変えていないもの", () => {
  it("超過を許さないプラン（allow_overflow=false）は引き直さず、DB と同じ暦窓で数える", () => {
    const u = computePlanUsage(
      { ...MONTHLY4, startDate: "2026-09-17", graceDays: 0, allowOverflow: false },
      bookings(["2026-10-03", "2026-10-10", "2026-10-24"]),
      at("2026-09-24"),
    );
    expect(format(u.windowStart!, "M/d")).toBe("9/17");
    expect(lastDay(u.windowEnd)).toBe("10/17");
    expect(u.used).toBe(2);
  });

  it("起算日固定（pinned）は引き直さない（店の設定が最上位）", () => {
    const u = computePlanUsage(
      { ...MONTHLY4, startDate: "2026-09-17", graceDays: 0, cycleStartPinned: true },
      bookings(["2026-10-03", "2026-10-10", "2026-10-24"]),
      at("2026-09-24"),
    );
    expect(format(u.windowStart!, "M/d")).toBe("9/17");
    expect(u.used).toBe(2);
  });

  it("1回目が起算日ちょうどなら何も変わらない", () => {
    const u = computePlanUsage(
      { ...MONTHLY4, startDate: "2026-10-03", graceDays: 0 },
      bookings(["2026-10-03", "2026-10-10"]),
      at("2026-09-24"),
    );
    expect(format(u.windowStart!, "M/d")).toBe("10/3");
    expect(u.used).toBe(2);
  });
});
