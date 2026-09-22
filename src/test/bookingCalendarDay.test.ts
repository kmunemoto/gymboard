import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isDayUnselectable, type CalendarDayRules } from "@/lib/bookingCalendarDay";

// ────────────────────────────────────────────────────────────────
// 「その日を選べるか」の規則（2026-09-22 に CustomerBooking から切り出した）
//
// 切り出す前は <Calendar disabled={...}> に6つの規則が直書きされていて、
// **規則としてのテストが1つも無かった**（画面を描かないと確かめられなかった）。
// 実際 2026-09-21 に、満枠の日を押せなくする規則が**一度も効いていない**まま
// 出荷されたのを本番で指摘されている。ここはその再発防止でもある。
//
// 🔴 壊しやすいのは「当日を塞がない」。塞ぐと、2026-09-05 に入れた
//    「上限で埋まった当日の空き状況を、その日に予約している人にだけ見せる」が消える。
// ────────────────────────────────────────────────────────────────

const TODAY = "2026-09-22";

const base = (over: Partial<CalendarDayRules> = {}): CalendarDayRules => ({
  today: TODAY,
  businessHours: { start: "10:00", end: "22:30" },
  closedDays: [],
  hasOwnBookingOn: () => false,
  isDayFull: () => false,
  staffSchedules: null,
  staffUserId: null,
  bookingWindowDays: 60,
  nextCyclePaymentGate: null,
  ...over,
});

describe("素の日", () => {
  it("営業日で何も無ければ選べる", () => {
    expect(isDayUnselectable("2026-09-25", base())).toBe(false);
  });
});

describe("過去日と当日", () => {
  it("昨日は選べない", () => {
    expect(isDayUnselectable("2026-09-21", base())).toBe(true);
  });

  it("🔴 当日は塞がない（締切は枠ごとに見る）", () => {
    // ここを true にすると「その日に予約している人に空き状況を見せる」が消える
    expect(isDayUnselectable(TODAY, base())).toBe(false);
  });
});

describe("店の都合", () => {
  it("受付終了の日は選べない", () => {
    const closedDays = [{ closed_date: "2026-09-25", manual: true, reason: null }];
    expect(isDayUnselectable("2026-09-25", base({ closedDays }))).toBe(true);
  });

  it("1枠も取れない日は選べない", () => {
    expect(isDayUnselectable("2026-09-25", base({ isDayFull: (d) => d === "2026-09-25" }))).toBe(true);
    expect(isDayUnselectable("2026-09-26", base({ isDayFull: (d) => d === "2026-09-25" }))).toBe(false);
  });

  it("予約できる範囲より先は選べない", () => {
    expect(isDayUnselectable("2026-12-25", base({ bookingWindowDays: 30 }))).toBe(true);
  });
});

describe("🔴 次回分の入金", () => {
  it("gate の日から後は選べない", () => {
    const r = base({ nextCyclePaymentGate: "2026-10-18" });
    expect(isDayUnselectable("2026-10-18", r)).toBe(true);
    expect(isDayUnselectable("2026-11-01", r)).toBe(true);
  });

  it("gate より前は今までどおり選べる", () => {
    const r = base({ nextCyclePaymentGate: "2026-10-18" });
    expect(isDayUnselectable("2026-10-17", r)).toBe(false);
    expect(isDayUnselectable("2026-09-30", r)).toBe(false);
  });

  it("🔴 gate が無ければ（既定・読めなかったとき）何も変わらない", () => {
    expect(isDayUnselectable("2099-01-01", base({ bookingWindowDays: null, nextCyclePaymentGate: null })))
      .toBe(isDayUnselectable("2099-01-01", base({ bookingWindowDays: null })));
  });
});

describe("🔴 規則が CustomerBooking へ散っていない", () => {
  const code = readFileSync("src/components/customer/CustomerBooking.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

  it("カレンダーは判定を1本呼ぶだけ", () => {
    expect(code).toContain('isDayUnselectable(format(date, "yyyy-MM-dd"), calendarDayRules)');
  });

  it("切り出した規則を画面側に残していない", () => {
    // 戻ってくると「押せない理由」が2か所に分かれ、片方だけ直す事故が起きる
    expect(code).not.toContain("isBeyondBookingWindow(");
    expect(code).not.toContain("isClosedDate(");
  });

  it("次回分の入金の日付を渡している", () => {
    expect(code).toContain("nextCyclePaymentGate,");
    expect(code).toContain("useNextCyclePaymentGate(tenant?.id ?? null)");
  });

  it("押す前に理由が分かる案内を出している", () => {
    expect(code).toContain("<NextCyclePaymentNotice gate={nextCyclePaymentGate} />");
  });
});
