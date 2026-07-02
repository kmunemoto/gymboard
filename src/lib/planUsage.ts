import { addDays, differenceInDays, parseISO, startOfDay } from "date-fns";
import { getCycleWindow } from "./courseProgress";
import { getJSTNow, toJSTDate } from "./timezone";

// GymBoard 共通: お客様のプラン消化状況（今サイクルであと何回予約できるか）を算出する。
// プラン種別ごとに「集計の窓（window）」が異なる点を吸収する:
//   - subscription（月N回など）: 毎月のサイクル窓。月初(契約応当日)でリセットされる。
//     max_sessions が null の場合は通い放題として無制限扱い。
//   - ticket（回数券）: 購入(=契約起算日)から有効期間(validity_days)までの一括窓。
//     月ではリセットされず、期間内の合計回数で消化する。
//   - period（期間プラン）: 有効期間の窓。回数無制限。
// 予約レコードから消化数を数えるため、サーバー側カウンタの有無に依存しない。

export type PlanKind = "subscription" | "ticket" | "period" | "unconfigured";

export interface PlanUsageInput {
  /** 'subscription' | 'ticket' | 'period'（tenant_plans.plan_type） */
  planType?: string | null;
  /** プランの回数上限（tenant_plans.max_sessions）。null = 無制限 */
  maxSessions?: number | null;
  /** 有効日数（tenant_plans.validity_days）。ticket/period の窓長 */
  validityDays?: number | null;
  /** 起算日（cycle_start_date / plan_start_date 等）ISO 文字列 */
  startDate?: string | null;
  /** サブスクのサイクル月数（tenant_plans.cycle_months）。null/未設定は1ヶ月 */
  cycleMonths?: number | null;
}

export interface PlanUsageBooking {
  /** ISO 文字列（例: 2026-07-05T14:00:00+09:00 もしくは 2026-07-05） */
  booking_date: string;
  status: string;
}

export interface PlanUsage {
  kind: PlanKind;
  /** 回数上限（無制限/未設定は null） */
  total: number | null;
  /** 窓内の消化数（実施済み＋予約済み、キャンセル除く） */
  used: number;
  /** 残り予約可能回数（無制限は null、下限0） */
  remaining: number | null;
  isUnlimited: boolean;
  /** 集計窓 [start, end)。end が無い（無期限）場合は null */
  windowStart: Date | null;
  windowEnd: Date | null;
  /** 窓終了までの残り日数（無期限は null） */
  daysLeft: number | null;
  isExpired: boolean;
  isUnconfigured: boolean;
}

const isCancelled = (s: string) => s === "キャンセル済み";

const UNCONFIGURED: PlanUsage = {
  kind: "unconfigured",
  total: null,
  used: 0,
  remaining: null,
  isUnlimited: false,
  windowStart: null,
  windowEnd: null,
  daysLeft: null,
  isExpired: false,
  isUnconfigured: true,
};

export function computePlanUsage(
  input: PlanUsageInput,
  bookings: PlanUsageBooking[],
  now: Date = getJSTNow(),
): PlanUsage {
  const { planType, maxSessions, validityDays, startDate, cycleMonths } = input;
  if (!startDate) return UNCONFIGURED;

  const anchor = startOfDay(parseISO(startDate));
  let kind: PlanKind;
  let windowStart: Date;
  let windowEnd: Date | null;

  if (planType === "ticket" || planType === "period") {
    kind = planType;
    windowStart = anchor;
    windowEnd = validityDays && validityDays > 0 ? addDays(anchor, validityDays) : null;
  } else {
    // subscription（既定）。月N回は cycleMonths ヶ月ごとにリセット（既定1ヶ月）。
    kind = "subscription";
    const cycle = getCycleWindow(startDate, now, cycleMonths);
    if (!cycle) return UNCONFIGURED;
    windowStart = cycle.start;
    windowEnd = cycle.end;
  }

  const used = bookings.filter((b) => {
    if (isCancelled(b.status)) return false;
    // 予約は絶対時刻。窓(JST擬似Date)と比較するため toJSTDate でJST基準に揃える。
    const d = toJSTDate(b.booking_date);
    if (d < windowStart) return false;
    if (windowEnd && d >= windowEnd) return false;
    return true;
  }).length;

  // period は常に無制限。subscription/ticket は max_sessions が null なら無制限（例: 通い放題）。
  const isUnlimited = kind === "period" || maxSessions == null;
  const total = isUnlimited ? null : maxSessions!;
  const remaining = total != null ? Math.max(0, total - used) : null;
  const daysLeft = windowEnd ? differenceInDays(windowEnd, now) : null;
  const isExpired = windowEnd ? now >= windowEnd : false;

  return {
    kind,
    total,
    used,
    remaining,
    isUnlimited,
    windowStart,
    windowEnd,
    daysLeft,
    isExpired,
    isUnconfigured: false,
  };
}

// プラン名 + tenant_plans 定義から PlanUsageInput を解決する。
// tenant_plans に該当があればそれを正とし、無ければ名称から推定（旧データ互換）。
export function resolvePlanUsageInput(
  planName: string | null | undefined,
  tenantPlan: { plan_type?: string | null; max_sessions?: number | null; validity_days?: number | null; cycle_months?: number | null } | null | undefined,
  startDate: string | null | undefined,
): PlanUsageInput | null {
  if (!planName) return null;
  if (tenantPlan) {
    return {
      planType: tenantPlan.plan_type ?? "subscription",
      maxSessions: tenantPlan.max_sessions ?? null,
      validityDays: tenantPlan.validity_days ?? null,
      startDate: startDate ?? null,
      cycleMonths: tenantPlan.cycle_months ?? null,
    };
  }
  // 旧データ互換: tenant_plans に無い名称
  if (planName === "通い放題") {
    return { planType: "subscription", maxSessions: null, validityDays: null, startDate: startDate ?? null };
  }
  const m = planName.match(/月(\d+)回/);
  if (m) {
    return { planType: "subscription", maxSessions: parseInt(m[1], 10), validityDays: null, startDate: startDate ?? null };
  }
  return null;
}
