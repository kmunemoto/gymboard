// 利用期間リマインドの「送るかどうか・どの節目か」を判定する純関数。
// エッジ関数（push-period-reminder）と同じ判定をクライアント側でも再現・テストできるよう、
// 消化状況（computePlanUsage の結果）を入力に取り、通知すべき節目（7日前/3日前）を返す。

import type { PlanUsage } from "./planUsage";

/** 通知する期限前の節目（日数）。大きい順（7日→3日）に判定する。 */
export const PERIOD_REMINDER_DAYS = [7, 3] as const;

export interface PeriodReminderDecision {
  /** 通知すべきなら該当節目の残り日数（7 or 3）、不要なら null */
  daysLeft: number | null;
  /** 残り予約可能回数（表示用） */
  remaining: number;
}

/**
 * 消化状況から、今日リマインドを送るべきかを判定する。
 * 条件（すべて満たすときのみ送る）:
 *   - サブスク（月N回など）で期限が確定している（periodPending でない・windowEnd あり）
 *   - 無制限（通い放題）でない
 *   - 残り予約回数が 1 以上ある（使い切っていれば案内不要）
 *   - 最終利用日（windowEnd - 1日）までの残り日数が PERIOD_REMINDER_DAYS のいずれかに一致
 * daysLeft は「最終利用日 − 今日」（暦日）。今日が最終利用日なら 0。
 */
export function decidePeriodReminder(
  usage: Pick<PlanUsage, "kind" | "isUnlimited" | "periodPending" | "windowEnd" | "remaining"> | null,
  now: Date,
  reminderDays: readonly number[] = PERIOD_REMINDER_DAYS,
): PeriodReminderDecision {
  const none: PeriodReminderDecision = { daysLeft: null, remaining: 0 };
  if (!usage) return none;
  if (usage.kind !== "subscription") return none;
  if (usage.isUnlimited || usage.periodPending) return none;
  if (!usage.windowEnd) return none;
  const remaining = usage.remaining ?? 0;
  if (remaining <= 0) return none;

  // 最終利用日 = windowEnd(排他上限) の前日。残り日数は暦日差。
  const MS = 86400000;
  const startOfDayUTC = (d: Date) => Math.floor(d.getTime() / MS);
  const lastDay = usage.windowEnd.getTime() - MS; // 最終利用日 00:00 相当
  const daysLeft = Math.round(startOfDayUTC(new Date(lastDay)) - startOfDayUTC(now));

  if (reminderDays.includes(daysLeft)) {
    return { daysLeft, remaining };
  }
  return none;
}
