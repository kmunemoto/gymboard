import { describe, it, expect } from "vitest";
import { computePlanUsage } from "@/lib/planUsage";
import { computeSubscriptionUsage, isoToJstYmd, periodReminderDaysLeft } from "../../supabase/functions/_shared/cycle";
import { decidePeriodReminder } from "@/lib/periodReminder";
import { toJSTDate } from "@/lib/timezone";

// エッジ関数の Deno 移植（_shared/cycle.ts）が、クライアント computePlanUsage と
// 同じ「窓・残り回数・期限未確定」を返すことを、複数シナリオで突き合わせる。

const b = (iso: string) => ({ booking_date: iso, status: "予約済み" });

type Scenario = {
  name: string;
  start: string;
  max: number | null;
  cycleMonths?: number | null;
  /** 利用期間の単位（tenant_plans.cycle_unit）。省略は months */
  cycleUnit?: string | null;
  graceDays?: number | null;
  /** 店が起算日を固定しているお客様（profiles.cycle_start_pinned） */
  pinned?: boolean;
  dates: string[];
  now: string;
};

const scenarios: Scenario[] = [
  { name: "月8回・2件消化", start: "2026-06-05", max: 8, dates: ["2026-06-06", "2026-06-10"], now: "2026-06-28" },
  { name: "月8回・使い切り", start: "2026-06-05", max: 8, dates: ["2026-06-06","2026-06-08","2026-06-10","2026-06-12","2026-06-15","2026-06-18","2026-06-21","2026-06-25"], now: "2026-06-28" },
  { name: "予約0件（期限未確定）", start: "2026-06-05", max: 8, dates: [], now: "2026-06-28" },
  { name: "未来の次ルーティン込み（先回りしない）", start: "2026-06-18", max: 4, dates: ["2026-06-18","2026-06-25","2026-07-02","2026-07-09","2026-07-17","2026-07-18"], now: "2026-07-04" },
  { name: "使い切り後の過去ロール", start: "2026-06-05", max: 8, dates: ["2026-06-06","2026-06-08","2026-06-10","2026-06-12","2026-06-15","2026-06-18","2026-06-21","2026-06-25","2026-06-28","2026-07-02"], now: "2026-07-03" },
  { name: "猶予繰入", start: "2026-06-04", max: 8, graceDays: 7, dates: ["2026-06-06","2026-06-10","2026-06-14","2026-06-18","2026-06-24","2026-06-29","2026-07-02","2026-07-05"], now: "2026-07-03" },
  { name: "2ヶ月サイクル", start: "2026-06-05", max: 12, cycleMonths: 2, dates: ["2026-06-10","2026-07-20"], now: "2026-07-25" },
  // 週・日の単位（2026-08-22）: ちょうど N×7日 / N日 の連続窓
  { name: "4週サイクル（2窓目）", start: "2026-06-05", max: 4, cycleMonths: 4, cycleUnit: "weeks", dates: ["2026-06-06","2026-06-20","2026-07-04"], now: "2026-07-10" },
  { name: "30日サイクル", start: "2026-06-05", max: 8, cycleMonths: 30, cycleUnit: "days", dates: ["2026-06-10","2026-06-20"], now: "2026-06-28" },
  // 起算日の固定（2026-08-22）: ロール・引き直しをせず、予約0件でも期限を出す
  { name: "起算日固定（超過してもロールしない）", start: "2026-06-05", max: 2, pinned: true, dates: ["2026-06-06","2026-06-08","2026-06-10"], now: "2026-06-28" },
  { name: "起算日固定（予約0でも期限確定）", start: "2026-06-05", max: 8, pinned: true, dates: [], now: "2026-06-10" },
];

describe("Deno cycle port ↔ client computePlanUsage パリティ", () => {
  for (const s of scenarios) {
    it(s.name, () => {
      const nowDate = toJSTDate(`${s.now}T12:00:00+09:00`);
      const client = computePlanUsage(
        { planType: "subscription", maxSessions: s.max, validityDays: null, startDate: s.start, cycleMonths: s.cycleMonths ?? null, cycleUnit: s.cycleUnit ?? null, graceDays: s.graceDays ?? null, cycleStartPinned: s.pinned ?? null },
        s.dates.map((d) => b(`${d}T10:00:00+09:00`)),
        nowDate,
      );
      const port = computeSubscriptionUsage({
        startYmd: s.start,
        maxSessions: s.max,
        cycleMonths: s.cycleMonths,
        cycleUnit: s.cycleUnit,
        graceDays: s.graceDays,
        bookingIsos: s.dates.map((d) => `${d}T10:00:00+09:00`),
        nowJstYmd: s.now,
        anchorToFirstBooking: true,
        pinned: s.pinned,
      })!;

      // 残り回数・期限未確定・無制限が一致
      expect(port.remaining).toBe(client.remaining);
      expect(port.periodPending).toBe(client.periodPending);
      expect(port.isUnlimited).toBe(client.isUnlimited);
      // 最終利用日（windowEnd-1日）が一致（JST暦日 yyyy-MM-dd で比較）
      const portLastYmd = isoToJstYmd(new Date(port.windowEnd - 86400000).toISOString());
      const clientLastYmd = client.windowEnd
        ? isoToJstYmd(new Date(client.windowEnd.getTime() - 86400000).toISOString())
        : null;
      expect(portLastYmd).toBe(clientLastYmd);

      // リマインド判定も一致
      const clientDecision = decidePeriodReminder(client, nowDate);
      const portDaysLeft = periodReminderDaysLeft(port.windowEnd, s.now);
      const portShouldRemind = !port.periodPending && !port.isUnlimited && (port.remaining ?? 0) > 0 && [7, 3].includes(portDaysLeft);
      expect(portShouldRemind).toBe(clientDecision.daysLeft !== null);
    });
  }
});
