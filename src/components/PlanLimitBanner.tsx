import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { useTenantLimit } from "@/hooks/useTenantLimit";
import { BILLING_ENABLED } from "@/lib/featureFlags";

interface Props {
  onUpgrade?: () => void;
  onManageCustomers?: () => void;
}

/**
 * Persistent warning shown to owner/trainer/customer when the tenant
 * is over its plan limits. Customers see only a neutral notice.
 * On native apps, billing CTAs are hidden (no in-app purchases).
 */
const PlanLimitBanner = ({ onUpgrade, onManageCustomers }: Props) => {
  const { t } = useTranslation();
  const { status, role } = useTenantLimit();
  const isNative = Capacitor.isNativePlatform();
  if (!BILLING_ENABLED) return null; // 課金無効化中は上限警告を出さない
  if (!status || !status.over_limit) return null;

  const parts: string[] = [];
  if (status.customer_over && status.max_customers !== null) {
    parts.push(t("planLimit.customerOver", { count: status.customer_count, max: status.max_customers }));
  }
  if (status.trainer_over && status.max_trainers !== null) {
    parts.push(t("planLimit.trainerOver", { count: status.trainer_count, max: status.max_trainers }));
  }
  const detail = parts.join(t("planLimit.listSeparator"));

  const isStaff = role === "owner" || role === "trainer";

  return (
    <div className="border-b border-warning/40 bg-warning/10 text-foreground px-3 sm:px-4 py-2.5">
      <div className="max-w-md md:max-w-none mx-auto flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
        <div className="flex-1 min-w-0 text-xs sm:text-sm">
          {isStaff ? (
            <>
              <p className="font-bold">{t("planLimit.overTitle", { detail })}</p>
              <p className="text-muted-foreground mt-0.5">
                {isNative ? t("planLimit.overDescNative") : t("planLimit.overDescWeb")}
              </p>
              {(onUpgrade || onManageCustomers) && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {onUpgrade && !isNative && (
                    <Button size="sm" variant="default" onClick={onUpgrade}>
                      {t("planLimit.upgrade")}
                    </Button>
                  )}
                  {onManageCustomers && (
                    <Button size="sm" variant="outline" onClick={onManageCustomers}>
                      {t("planLimit.manageCustomers")}
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p>{t("planLimit.customerNotice")}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlanLimitBanner;
