import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTenantLimit } from "@/hooks/useTenantLimit";

interface Props {
  onUpgrade?: () => void;
  onManageCustomers?: () => void;
}

/**
 * Persistent warning shown to owner/trainer/customer when the tenant
 * is over its plan limits. Customers see only a neutral notice.
 */
const PlanLimitBanner = ({ onUpgrade, onManageCustomers }: Props) => {
  const { status, role } = useTenantLimit();
  if (!status || !status.over_limit) return null;

  const parts: string[] = [];
  if (status.customer_over && status.max_customers !== null) {
    parts.push(`顧客 ${status.customer_count}名／上限 ${status.max_customers}名`);
  }
  if (status.trainer_over && status.max_trainers !== null) {
    parts.push(`トレーナー ${status.trainer_count}名／上限 ${status.max_trainers}名`);
  }
  const detail = parts.join("、");

  const isStaff = role === "owner" || role === "trainer";

  return (
    <div className="border-b border-warning/40 bg-warning/10 text-foreground px-3 sm:px-4 py-2.5">
      <div className="max-w-md md:max-w-none mx-auto flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
        <div className="flex-1 min-w-0 text-xs sm:text-sm">
          {isStaff ? (
            <>
              <p className="font-bold">プランの上限を超えています（{detail}）。</p>
              <p className="text-muted-foreground mt-0.5">
                アップグレードするか、顧客を上限以下にしてください。解消されるまで新規予約・記録などの作成ができません。
              </p>
              {(onUpgrade || onManageCustomers) && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {onUpgrade && (
                    <Button size="sm" variant="default" onClick={onUpgrade}>
                      プランをアップグレード
                    </Button>
                  )}
                  {onManageCustomers && (
                    <Button size="sm" variant="outline" onClick={onManageCustomers}>
                      顧客管理
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p>
              ジムが現在プラン上限を超えています。新しい記録の作成が一時的にできません。
              オーナーにご確認ください。
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlanLimitBanner;
