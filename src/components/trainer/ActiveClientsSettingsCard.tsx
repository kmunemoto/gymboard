import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import {
  ACTIVE_CLIENT_BASES, FOLLOW_UP_DAY_CHOICES,
  resolveActiveClientBasis, resolveFollowUpAfterDays, type ActiveClientBasis,
} from "@/lib/activeClients";

/**
 * 「アクティブ顧客」の数え方と、フォローの目安日数（ジムごと）。
 * 規則は `src/lib/activeClients.ts`、経緯は `mem/features/active-clients.md`。
 *
 * 🔴 **既定は今まで通り**（在籍の全員・14日）。回数券の店のように1回ずつ予約する
 * 運用では、次の予約が無いのが普通なので「次回予約あり」だと通っている人まで消える。
 *
 * 目安日数は「フォローが必要な顧客」と**同じ値**。数字を2か所に持たせないので、
 * ホーム画面の「離れている ◯名」と一覧は必ず同じ人たちになる。
 *
 * 置き場: TrainerGymSettings の表示設定、統計カードのON/OFFの直後。
 * 別ファイルなのは TrainerGymSettings が行数の上限（`qualityRatchet.test.ts`）に達しているため。
 */
const ActiveClientsSettingsCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();

  // 読めない値は今まで通りに倒す（列が未適用の環境でも画面が壊れない）
  const basis = resolveActiveClientBasis(tenant?.active_client_basis);
  const days = resolveFollowUpAfterDays(tenant?.follow_up_after_days);

  const save = async (patch: { active_client_basis?: ActiveClientBasis; follow_up_after_days?: number }) => {
    if (!tenant) return;
    const { error } = await supabase.from("tenants").update(patch).eq("id", tenant.id);
    if (error) {
      console.error("アクティブ顧客の設定の保存に失敗:", error);
      toast.error(t("settings.trainer.activeClientsSaveFailed"), { description: error.message });
      return;
    }
    toast.success(t("settings.trainer.activeClientsSaved"));
    refetchTenant();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <h4 className="font-bold text-sm">{t("settings.trainer.activeClientsGroup")}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.activeClientsDesc")}</p>
        </div>

        <RadioGroup
          value={basis}
          onValueChange={(v) => void save({ active_client_basis: resolveActiveClientBasis(v) })}
          disabled={!tenant}
          className="space-y-2"
        >
          {ACTIVE_CLIENT_BASES.map((b) => (
            <div key={b} className="flex items-start gap-2.5">
              <RadioGroupItem id={`active-basis-${b}`} value={b} className="mt-0.5" />
              <Label htmlFor={`active-basis-${b}`} className="font-normal cursor-pointer space-y-0.5">
                <span className="block text-sm font-bold">{t(`settings.trainer.activeClientsBasis.${b}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`settings.trainer.activeClientsBasisDesc.${b}`)}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>

        <div className="space-y-1.5">
          <Label htmlFor="follow-up-after-days" className="text-sm font-bold">
            {t("settings.trainer.followUpAfterLabel")}
          </Label>
          <Select
            value={String(days)}
            onValueChange={(v) => void save({ follow_up_after_days: resolveFollowUpAfterDays(Number(v)) })}
            disabled={!tenant}
          >
            <SelectTrigger id="follow-up-after-days" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FOLLOW_UP_DAY_CHOICES.map((d) => (
                <SelectItem key={d} value={String(d)}>{t("settings.trainer.followUpAfterOption", { days: d })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("settings.trainer.followUpAfterDesc")}</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default ActiveClientsSettingsCard;
