/**
 * 🔴 今ある回数は「保存された起算日」から数える（2026-11-02 に元へ戻した）。
 *
 * 同じ日に「今のプランの予約の1回目から自動で数える」（予約の履歴から区切りを引き直す）を入れた。
 * すると何人かのお客様の回数が変わった（下のお客様の 11/7 が 6/8 → 3/8）。宗本さん:
 * > 何人かのお客様の回数が狂ったぞ… これからでいい
 * > 今入ってた回数は合ってるから変えないで。正確なお客様の回数が分からなくなる
 *
 * 保存された起算日は、自動の設定と店の手直しで積み上がってきたもので、店が数えてきた回数の正。
 * 予約の履歴から最初に引き直すと、その時々の事情が消えて回数が変わる（mem/features/course-progress-cycle.md）。
 * 数え方を変えるときは、これからの区切りにだけ効かせる。このテストが赤になったら、宗本さんに確かめてから進めること。
 *
 * 本番の実データ（日付と予約の種類だけ。名前は持たない）。
 */
import { describe, it, expect } from "vitest";
import { getBookingProgressIndex, type BookingForProgress } from "@/lib/courseProgress";
import { computePlanUsage, resolvePlanUsageInput, type PlanUsageBooking } from "@/lib/planUsage";
import { toJSTDate } from "@/lib/timezone";
import { addDays, format } from "date-fns";

type Row = [date: string, time: string, type: string];
const rows = (list: Row[]) =>
  list.map(([d, t, type], i) => ({ id: `b${i}-${d}`, booking_date: `${d}T${t}:00+09:00`, status: "予約済み", booking_type: type }));
const chipOf = (bookings: BookingForProgress[], saved: string, plan: string, date: string) => {
  const b = bookings.find((x) => x.booking_date.startsWith(date))!;
  const r = getBookingProgressIndex(b.id, saved, plan, bookings, 1, 0, "months", false);
  return r ? `${r.index}/${r.total}` : null;
};
const md = (d: Date | null) => (d ? format(d, "MM/dd") : null);
const NOW = toJSTDate("2026-11-02T20:06:00+09:00"); // スクリーンショットの時刻

describe("月8回・保存された起算日 10/18 のお客様（赤丸のお客様）", () => {
  const PLAN = "月8回";
  const B = rows([
    ["2026-10-04", "10:00", PLAN], ["2026-10-11", "11:15", PLAN], ["2026-10-18", "11:30", PLAN], ["2026-10-21", "19:15", PLAN],
    ["2026-10-24", "09:30", PLAN], ["2026-10-28", "20:15", PLAN], ["2026-10-31", "11:15", PLAN], ["2026-11-07", "12:30", PLAN],
    ["2026-11-10", "19:15", PLAN], ["2026-11-14", "11:30", PLAN], ["2026-11-17", "19:15", PLAN],
  ]);

  it("予定表の 11/7 は 6/8（10/18 から数える。履歴から引き直した 3/8 にしない）", () => {
    expect(chipOf(B, "2026-10-18", PLAN, "2026-11-07")).toBe("6/8");
    expect(chipOf(B, "2026-10-18", PLAN, "2026-10-18")).toBe("1/8");
    expect(chipOf(B, "2026-10-18", PLAN, "2026-11-14")).toBe("8/8");
    expect(chipOf(B, "2026-10-18", PLAN, "2026-11-17")).toBe("1/8"); // 使い切ったあとは次の1回目
  });

  it("カードは 10/18〜11/18・予約済み 8/8", () => {
    const input = resolvePlanUsageInput(PLAN, { plan_type: "subscription", max_sessions: 8, grace_days: 7 }, "2026-10-18", false)!;
    input.graceDays = 0; // このお客様は猶予OFF
    const u = computePlanUsage(input, B as PlanUsageBooking[], NOW);
    expect([md(u.windowStart), md(u.windowEnd ? addDays(u.windowEnd, -1) : null), u.used]).toEqual(["10/18", "11/18", 8]);
  });
});

describe("プランを変えたあとに、店が起算日を 11/2 に決めたお客様", () => {
  // 月6回の予約のあと月4回の予約 10/4, 10/18 があり、店が 11/2 を起算日にした（宗本さんが手で直した値）
  const B = rows([
    ["2026-09-28", "16:00", "月6回"],
    ["2026-10-04", "16:15", "月4回"], ["2026-10-18", "10:15", "月4回"], ["2026-11-02", "16:00", "月4回"],
    ["2026-11-09", "11:15", "月4回"], ["2026-11-15", "10:15", "月4回"], ["2026-11-19", "10:15", "月4回"],
  ]);

  it("11/2 は 1/4（予約の種類から 10/4 起点に引き直して 3/4 にしない）", () => {
    expect(chipOf(B, "2026-11-02", "月4回", "2026-11-02")).toBe("1/4");
    expect(chipOf(B, "2026-11-02", "月4回", "2026-11-19")).toBe("4/4");
  });

  it("起算日より前の予約には回数を付けない（今までどおり）", () => {
    expect(chipOf(B, "2026-11-02", "月4回", "2026-10-18")).toBeNull();
  });
});
