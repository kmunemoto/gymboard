import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { getJSTToday } from "@/lib/timezone";

/**
 * 次回分の入金を確認するまで、次回分の予約を受け付けないか
 * （`tenants.next_cycle_payment_required`。既定 OFF）。規則の全体は
 * `src/lib/nextCyclePayment.ts` と `mem/features/next-cycle-payment.md`。
 *
 * ## 🔴 ON にした日を必ず一緒に書く
 *
 * `next_cycle_payment_required_since` に ON にした日を入れ、DB 側は
 * **その日までに始まっていたサイクル窓を「払い済み」扱い**にする。
 * これが無いと、ON にした瞬間に在籍会員が**全員まとめて予約できなくなる**
 * （本番の自社ジムで 38 人）。偽の入金行を作らずに初日を乗り切るための1列。
 *
 * OFF にしても `since` は消さない。次に ON にしたときに上書きする
 * （消すと、OFF→ON を繰り返すたびに全員が止まる日を作ってしまう）。
 *
 * ## 置き場
 *
 * TrainerGymSettings の「予約」カテゴリー。別ファイルなのは TrainerGymSettings が
 * 行数の上限（`qualityRatchet.test.ts`）に達しているため（TrialIgnoreBlocksCard と同じ）。
 */
const NextCyclePaymentCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();

  // 🔴 `=== true` で見る。列が未適用の環境では undefined＝OFF＝従来どおり（安全側）。
  const enabled = tenant?.next_cycle_payment_required === true;

  const handleToggle = async (next: boolean) => {
    if (!tenant) return;
    const patch = next
      // ON にした日を必ず一緒に書く（この日までに始まっていた窓は払い済み扱いになる）
      ? { next_cycle_payment_required: true, next_cycle_payment_required_since: getJSTToday() }
      : { next_cycle_payment_required: false };
    const { error } = await supabase.from("tenants").update(patch).eq("id", tenant.id);
    if (error) {
      // 失敗理由（例: カラム未追加＝マイグレーション未適用）を画面でも確認できるようにする
      console.error("次回分の入金ゲートの保存に失敗:", error);
      toast.error(t("settings.trainer.nextCyclePaymentSaveFailed"), { description: error.message });
      return;
    }
    toast.success(t("settings.trainer.nextCyclePaymentSaved"));
    refetchTenant();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="next-cycle-payment" className="text-sm font-bold">
              {t("settings.trainer.nextCyclePaymentLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.trainer.nextCyclePaymentDesc")}
            </p>
          </div>
          <Switch
            id="next-cycle-payment"
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label={t("settings.trainer.nextCyclePaymentLabel")}
          />
        </div>
        {enabled && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {t("settings.trainer.nextCyclePaymentWarning")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default NextCyclePaymentCard;
