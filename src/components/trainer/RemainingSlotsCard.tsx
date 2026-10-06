import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

/**
 * お客様の予約カレンダーに「残り枠」を出すか（`tenants.show_remaining_slots`。既定 OFF）。
 *
 * 宗本さん（2026-10-06）「お客様側の予約サイトで各日にちが残り何枠空いているか
 * リアルタイムで表示される機能を追加して」。
 *
 * 空き具合はジムの混み具合そのものなので、見せるかはジムが決める（既定は今まで通り出さない）。
 * 数え方は `src/lib/dayRemainingSlots.ts`、表示は `src/components/booking/BookingCalendarDay.tsx`。
 *
 * 置き場は TrainerGymSettings の予約の設定。別ファイルなのは、あのファイルが
 * 行数の上限（`qualityRatchet.test.ts`）に達しているため（`TrialIgnoreBlocksCard` と同じ形）。
 */
const RemainingSlotsCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();

  // `=== true` で見る。列が未適用の環境では undefined ＝出さない（今まで通り）に倒れる
  const enabled = tenant?.show_remaining_slots === true;

  const handleToggle = async (next: boolean) => {
    if (!tenant) return;
    const { error } = await supabase
      .from("tenants")
      .update({ show_remaining_slots: next } as never)
      .eq("id", tenant.id);
    if (error) {
      console.error("残り枠の表示設定の保存に失敗:", error);
      toast.error(t("settings.trainer.showRemainingSlotsSaveFailed"), { description: error.message });
      return;
    }
    toast.success(t("settings.trainer.showRemainingSlotsSaved"));
    refetchTenant();
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="show-remaining-slots" className="text-sm font-bold">
              {t("settings.trainer.showRemainingSlotsLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("settings.trainer.showRemainingSlotsDesc")}</p>
          </div>
          <Switch
            id="show-remaining-slots"
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label={t("settings.trainer.showRemainingSlotsLabel")}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default RemainingSlotsCard;
