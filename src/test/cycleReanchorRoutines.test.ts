/**
 * どの区切りも「その区切りの1回目の予約日」から1ヶ月で数える（2026-10-15）。
 *
 * 宗本さん（予定表のスクリーンショット）:
 * > 次回の1回目のトレーニング日が10/22やから11/22までで4回なのに11/12の予約がまた1回目って
 * > どういうこと？ 1回目から自動的に1ヶ月間で計算するようにしろよ
 *
 * 本番の実データ（日付だけ。名前は持たない）: 月4回・猶予OFF・起算日 10/6（固定なし）、
 * 予約 9/10, 9/14（起算日より前）, 10/22, 10/29, 11/5, 11/12。
 * チップは暦窓 [10/6, 11/7) / [11/7, 12/7) で数え、11/12 を「1/4」と出していた。
 * カード（computePlanUsage）は最後の区切りだけ 10/22 起点に引き直していたので「4/4」。
 *
 * 🔴 壊しやすいもの:
 *   1. チップだけ暦窓のまま（カードと食い違う）
 *   2. 最後の区切りだけ引き直し、途中の区切りを応当日で切る（間が空くたびに数がずれる）
 *   3. 起算日固定（pinned）のお客様まで引き直す（店の設定が最上位）
 *   4. 猶予で前の区切りへ回した予約が、引き直しで数えられなくなる
 *   5. サーバー側の写し（期限のお知らせ）とずれる
 */
import { describe, it, expect } from "vitest";
import { getBookingProgressIndex, resolveEffectiveCycle, type BookingForProgress } from "@/lib/courseProgress";
import { computePlanUsage } from "@/lib/planUsage";
import { computeSubscriptionUsage } from "../../supabase/functions/_shared/cycle";
import { toJSTDate } from "@/lib/timezone";
import { format } from "date-fns";

const mk = (rows: [string, string][]): BookingForProgress[] =>
  rows.map(([d, t], i) => ({ id: `b${i}-${d}`, booking_date: `${d}T${t}:00+09:00`, status: "予約済み" }));

const START = "2026-10-06";
const REAL = mk([
  ["2026-09-10", "21:30"], ["2026-09-14", "17:00"],
  ["2026-10-22", "17:30"], ["2026-10-29", "17:00"], ["2026-11-05", "16:00"], ["2026-11-12", "17:30"],
]);
const chip = (bookings: BookingForProgress[], date: string, opts: { pinned?: boolean } = {}) => {
  const b = bookings.find((x) => x.booking_date.startsWith(date))!;
  const r = getBookingProgressIndex(b.id, START, "月4回", bookings, 1, 0, "months", opts.pinned ?? false);
  return r ? `${r.index}/${r.total}` : null;
};
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

describe("本番の実データ（月4回・起算日 10/6・1回目 10/22）", () => {
  it("🔴 10/22〜11/22 の4回: 10/22=1/4, 10/29=2/4, 11/5=3/4, 11/12=4/4（以前は 11/12 が 1/4）", () => {
    expect(chip(REAL, "2026-10-22")).toBe("1/4");
    expect(chip(REAL, "2026-10-29")).toBe("2/4");
    expect(chip(REAL, "2026-11-05")).toBe("3/4");
    expect(chip(REAL, "2026-11-12")).toBe("4/4");
  });

  it("次の区切りも、その1回目の日から（間が空いても応当日で切らない）", () => {
    const more = [...REAL, ...mk([["2026-12-03", "17:00"], ["2026-12-10", "17:00"], ["2027-01-02", "17:00"]])];
    expect(chip(more, "2026-12-03")).toBe("1/4");
    expect(chip(more, "2026-12-10")).toBe("2/4");
    // 12/3 起点の区切りは 1/3 まで（応当日 1/3 は前の区切りの最終日）
    expect(chip(more, "2027-01-02")).toBe("3/4");
  });

  it("🔴 カード（computePlanUsage）とチップが同じ区切り・同じ回数を出す", () => {
    const now = toJSTDate("2026-10-15T12:00:00+09:00");
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: 4, validityDays: null, startDate: START, cycleMonths: 1, cycleUnit: null, graceDays: 0, cycleStartPinned: false },
      REAL.map((b) => ({ booking_date: b.booking_date, status: b.status })),
      now,
    );
    expect(usage.kind).toBe("subscription");
    if (usage.kind !== "subscription") return;
    expect(ymd(usage.windowStart!)).toBe("2026-10-22");
    expect(usage.remaining).toBe(0);
    expect(usage.used).toBe(4);
    // チップの最後（4/4）と一致
    expect(chip(REAL, "2026-11-12")).toBe(`${usage.used}/4`);
  });

  it("区切りが終わったあとのカード: 次の1回目（12/3）から数える（途中の区切りも引き直す）", () => {
    const more = [...REAL, ...mk([["2026-12-03", "17:00"]])];
    const eff = resolveEffectiveCycle({
      cycleStartDate: START, maxSessions: 4, cycleMonths: 1, graceDays: 0,
      bookings: more, referenceDate: toJSTDate("2026-11-25T12:00:00+09:00"), anchorToFirstBooking: true,
    });
    expect(eff!.cycleStartDate).toBe("2026-12-03");
    expect(eff!.used).toBe(1);
  });

  it("🔴 起算日固定（pinned）のお客様は引き直さない（店が決めた暦どおり。11/12 は次の期間の 1/4）", () => {
    expect(chip(REAL, "2026-11-12", { pinned: true })).toBe("1/4");
  });

  it("超過を許さないプラン（allow_overflow=false）は引き直さない（DB の GB004 は暦窓で数える）", () => {
    const eff = resolveEffectiveCycle({
      cycleStartDate: START, maxSessions: 4, cycleMonths: 1, graceDays: 0, allowOverflow: false,
      bookings: REAL, referenceDate: toJSTDate("2026-11-12T12:00:00+09:00"), reanchorRoutines: true,
    });
    expect(eff!.cycleStartDate).toBe(START);
  });
});

describe("サーバー側の写し（期限のお知らせ）と揃う", () => {
  const isos = REAL.map((b) => b.booking_date);
  for (const [now, start, used] of [
    ["2026-10-15", "2026-10-22", 4],
    ["2026-11-12", "2026-10-22", 4],
  ] as const) {
    it(`${now} 時点: 期間の開始 ${start}・消化 ${used}（クライアントと同じ）`, () => {
      const server = computeSubscriptionUsage({
        startYmd: START, maxSessions: 4, cycleMonths: 1, graceDays: 0,
        bookingIsos: isos, nowJstYmd: now, anchorToFirstBooking: true,
      })!;
      const client = resolveEffectiveCycle({
        cycleStartDate: START, maxSessions: 4, cycleMonths: 1, graceDays: 0,
        bookings: REAL, referenceDate: toJSTDate(`${now}T12:00:00+09:00`), anchorToFirstBooking: true,
      })!;
      expect(client.cycleStartDate).toBe(start);
      expect(client.used).toBe(used);
      expect(server.used).toBe(used);
      expect(new Date(server.windowStart).toISOString().slice(0, 10)).toBe(start);
    });
  }

  it("区切りが終わったあと（11/25・次の1回目 12/3）も揃う", () => {
    const more = [...isos, "2026-12-03T17:00:00+09:00"];
    const server = computeSubscriptionUsage({
      startYmd: START, maxSessions: 4, cycleMonths: 1, graceDays: 0,
      bookingIsos: more, nowJstYmd: "2026-11-25", anchorToFirstBooking: true,
    })!;
    expect(new Date(server.windowStart).toISOString().slice(0, 10)).toBe("2026-12-03");
    expect(server.used).toBe(1);
  });
});
