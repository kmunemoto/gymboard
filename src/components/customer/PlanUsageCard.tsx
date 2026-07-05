import { useTranslation } from "react-i18next";
import { format, subDays } from "date-fns";
import { ja } from "date-fns/locale";
import { CreditCard, Clock, CalendarCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import PlanUsageBadge from "./PlanUsageBadge";
import { computePlanUsage, resolvePlanUsageInput, type PlanUsageBooking } from "@/lib/planUsage";
import type { TenantPlan } from "@/hooks/useTenant";
import { getJSTNow } from "@/lib/timezone";

// GymBoard 共通: お客様のプラン消化状況カード。
// 予約画面・ホーム・トレーナーのお客様詳細など、どこからでも同じ見た目で差し込める。
// 集計ロジックは src/lib/planUsage.ts に集約（月N回 / 回数券 / 期間プラン / 通い放題 対応）。
interface PlanUsageCardProps {
  planName?: string | null;
  cycleStartDate?: string | null;
  tenantPlans: TenantPlan[];
  /** お客様の予約一覧（booking_date は ISO 文字列） */
  bookings: PlanUsageBooking[];
  /** 猶予（大目に見る）をこのお客様に適用するか（profiles.grace_enabled）。false で無効、null/未指定は適用 */
  graceEnabled?: boolean | null;
  className?: string;
}

// 予約種別ではないもの（体験・未設定）はカードを出さない
const EXCLUDED_PLAN_NAMES = new Set(["初回無料体験", "プラン未設定"]);

const PlanUsageCard = ({ planName, cycleStartDate, tenantPlans, bookings, graceEnabled, className }: PlanUsageCardProps) => {
  const { t } = useTranslation();

  if (!planName || EXCLUDED_PLAN_NAMES.has(planName)) return null;
  const tenantPlan = tenantPlans.find((p) => p.plan_name === planName) ?? null;
  const input = resolvePlanUsageInput(planName, tenantPlan, cycleStartDate);
  if (!input) return null;
  // 猶予OFFのお客様には猶予を適用しない（期限どおり厳格に扱う）
  if (graceEnabled === false) input.graceDays = 0;

  const usage = computePlanUsage(input, bookings, getJSTNow());
  if (usage.isUnconfigured) return null;

  const daysLeft = usage.daysLeft;
  // 期限未確定（1回目の予約待ち）の間は期限切れ・期限間近の警告も出さない
  const isExpired = usage.isExpired && !usage.periodPending;
  const isExpiringSoon = !usage.periodPending && daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;

  return (
    <Card className={`border-l-4 ${isExpired ? "border-l-destructive bg-destructive/5" : isExpiringSoon ? "border-l-warning bg-warning/5" : "border-l-accent bg-accent/5"} ${className ?? ""}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CreditCard className="w-4 h-4 text-accent shrink-0" />
            <span className="text-sm font-bold truncate">{t("booking.currentPlan", { plan: planName })}</span>
          </div>
          <PlanUsageBadge usage={usage} />
        </div>

        {usage.periodPending ? (
          /* 期限未確定: 1回目の予約が入るまで期限は決まっていない（予約時に起算日へ自動設定） */
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{t("booking.periodPending")}</span>
          </div>
        ) : usage.windowStart && usage.windowEnd && (
          <div className="flex items-center gap-2">
            <Clock className={`w-4 h-4 shrink-0 ${isExpired ? "text-destructive" : isExpiringSoon ? "text-warning" : "text-accent"}`} />
            <span className="text-xs text-muted-foreground">
              {/* windowEnd は排他的上限（[start, end)）。表示は最終利用日 = end - 1日 にする
                  （例: 6/20起算の月次なら 6/20〜7/20。トレーナー側の満了日判定と同じ規則）。 */}
              {t("booking.usagePeriod", { start: format(usage.windowStart, "M/d", { locale: ja }), end: format(subDays(usage.windowEnd, 1), "M/d", { locale: ja }) })}
              {isExpired ? (
                <span className="font-bold text-destructive ml-1">{t("booking.expired")}</span>
              ) : usage.notStarted ? (
                /* 期間開始前は「残り◯日」を出さない（未開始の期間を今日から数えると混乱するため） */
                <span className="font-bold ml-1 text-accent">{t("booking.startsOn", { date: format(usage.windowStart, "M/d", { locale: ja }) })}</span>
              ) : daysLeft !== null ? (
                <span className={`font-bold ml-1 ${isExpiringSoon ? "text-warning" : "text-foreground"}`}>{t("booking.daysLeft", { count: daysLeft })}</span>
              ) : null}
            </span>
          </div>
        )}

        {!isExpired && !usage.isUnlimited && usage.total != null && (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${usage.remaining === 0 ? "bg-destructive" : usage.remaining === 1 ? "bg-warning" : "bg-accent"}`}
                style={{ width: `${Math.min(100, Math.round((usage.used / usage.total) * 100))}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">{t("booking.usedOfTotal", { used: usage.used, total: usage.total })}</p>
          </div>
        )}

        {!isExpired && usage.isUnlimited && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <CalendarCheck className="w-3.5 h-3.5 text-accent shrink-0" />
            {t("booking.usedUnlimited", { used: usage.used })}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default PlanUsageCard;
