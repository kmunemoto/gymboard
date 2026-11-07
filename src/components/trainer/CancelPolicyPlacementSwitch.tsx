import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

/**
 * キャンセルについての案内を「当日のキャンセル・変更のときだけ出す」スイッチ
 * （`tenants.cancel_policy_same_day_only`・2026-11-07）。TrainerGymSettings の案内の入力欄の下に置く。
 *
 * 宗本さん「予約するページの上のキャンセルについてを出さなくていい。当日キャンセルされる場合にだけ出して。
 * …当日のキャンセルと明日以降への日時変更の際だけ表示されるようにして」。
 * どこに出すかの決まりは `src/lib/cancelPolicyDisplay.ts`。押したらすぐ保存する（案内の文章の保存とは別）。
 *
 * 別ファイルなのは、TrainerGymSettings が行数の上限（`qualityRatchet.test.ts`）に近いため（`SameDayRulesCard` と同じ形）。
 */
const CancelPolicyPlacementSwitch = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [saving, setSaving] = useState(false);

  const save = async (checked: boolean) => {
    if (!tenant) return;
    setSaving(true);
    const { error } = await supabase.from("tenants").update({ cancel_policy_same_day_only: checked }).eq("id", tenant.id);
    if (error) toast.error(t("settings.trainer.cancelPolicySaveFailed"));
    else {
      toast.success(t("settings.trainer.cancelPolicySaved"));
      refetchTenant();
    }
    setSaving(false);
  };

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
      <div>
        <Label htmlFor="cancel-policy-same-day-only" className="font-bold text-sm">
          {t("settings.trainer.cancelPolicySameDayOnlyTitle")}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.cancelPolicySameDayOnlyDesc")}</p>
      </div>
      <Switch
        id="cancel-policy-same-day-only"
        // `=== true` で見る。列が未適用の環境では undefined ＝オフ（今まで通り）に倒れる
        checked={tenant?.cancel_policy_same_day_only === true}
        disabled={saving || !tenant}
        onCheckedChange={save}
        aria-label={t("settings.trainer.cancelPolicySameDayOnlyTitle")}
      />
    </div>
  );
};

export default CancelPolicyPlacementSwitch;
