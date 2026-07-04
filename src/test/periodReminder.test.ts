import { describe, it, expect } from "vitest";
import { computePlanUsage } from "@/lib/planUsage";
import { decidePeriodReminder } from "@/lib/periodReminder";
import { toJSTDate } from "@/lib/timezone";

const b = (iso: string, status = "予約済み") => ({ booking_date: iso, status });

// 月8回・起算日6/5 → 最終利用日は 7/5（アニバーサリー当日を含む）、windowEnd は 7/6。
const plan = { planType: "subscription", maxSessions: 8, validityDays: null, startDate: "2026-06-05" } as const;
const twoBookings = [b("2026-06-06T10:00:00+09:00"), b("2026-06-10T10:00:00+09:00")];

const usageAt = (now: Date) => computePlanUsage(plan, twoBookings, now);

describe("decidePeriodReminder", () => {
  it("期限7日前（6/28）に残り回数ありなら 7日前リマインド", () => {
    const now = toJSTDate("2026-06-28T12:00:00+09:00");
    const r = decidePeriodReminder(usageAt(now), now);
    expect(r.daysLeft).toBe(7);
    expect(r.remaining).toBe(6);
  });

  it("期限3日前（7/2）に残り回数ありなら 3日前リマインド", () => {
    const now = toJSTDate("2026-07-02T12:00:00+09:00");
    const r = decidePeriodReminder(usageAt(now), now);
    expect(r.daysLeft).toBe(3);
  });

  it("節目でない日（5日前=6/30）は送らない", () => {
    const now = toJSTDate("2026-06-30T12:00:00+09:00");
    expect(decidePeriodReminder(usageAt(now), now).daysLeft).toBeNull();
  });

  it("回数を使い切っていれば送らない（残り0）", () => {
    const eight = [
      "2026-06-06", "2026-06-08", "2026-06-10", "2026-06-12",
      "2026-06-15", "2026-06-18", "2026-06-21", "2026-06-25",
    ].map((d) => b(`${d}T10:00:00+09:00`));
    const now = toJSTDate("2026-06-28T12:00:00+09:00");
    const usage = computePlanUsage(plan, eight, now);
    expect(decidePeriodReminder(usage, now).daysLeft).toBeNull();
  });

  it("期限未確定（予約0件）は送らない", () => {
    const now = toJSTDate("2026-06-28T12:00:00+09:00");
    const usage = computePlanUsage(plan, [], now);
    expect(usage.periodPending).toBe(true);
    expect(decidePeriodReminder(usage, now).daysLeft).toBeNull();
  });

  it("通い放題（無制限）は送らない", () => {
    const now = toJSTDate("2026-06-28T12:00:00+09:00");
    const usage = computePlanUsage(
      { planType: "subscription", maxSessions: null, validityDays: null, startDate: "2026-06-05" },
      twoBookings,
      now,
    );
    expect(decidePeriodReminder(usage, now).daysLeft).toBeNull();
  });

  it("回数券(ticket)は対象外", () => {
    const now = toJSTDate("2026-06-28T12:00:00+09:00");
    const usage = computePlanUsage(
      { planType: "ticket", maxSessions: 10, validityDays: 90, startDate: "2026-06-05" },
      twoBookings,
      now,
    );
    expect(decidePeriodReminder(usage, now).daysLeft).toBeNull();
  });
});
