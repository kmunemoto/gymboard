import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/hooks/useTenant";
import { isTenantSubscriptionBlocked } from "@/lib/subscriptionStatus";

interface Props {
  onManage?: () => void;
}

// サブスク延滞/停止でジムの利用が制限されている旨を常時表示する。
// 実際の新規予約・記録のブロックはDBトリガー(enforce_tenant_plan_limit)が強制する。
// ネイティブアプリでは課金導線（CTA）を出さない（IAP不可のため）。
const SubscriptionBlockedBanner = ({ onManage }: Props) => {
  const { t } = useTranslation();
  const { tenant, role } = useTenant();
  if (!isTenantSubscriptionBlocked(tenant)) return null;

  const isStaff = role === "owner" || role === "trainer";
  const isNative = Capacitor.isNativePlatform();

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 text-foreground px-3 sm:px-4 py-2.5">
      <div className="max-w-md md:max-w-none mx-auto flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
        <div className="flex-1 min-w-0 text-xs sm:text-sm">
          <p className="font-bold">{t("subscriptionBlock.title")}</p>
          <p className="text-muted-foreground mt-0.5">
            {isStaff ? t("subscriptionBlock.staffBody") : t("subscriptionBlock.customerBody")}
          </p>
          {isStaff && !isNative && onManage && (
            <Button size="sm" variant="destructive" className="mt-2 h-8" onClick={onManage}>
              {t("subscriptionBlock.manage")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionBlockedBanner;
