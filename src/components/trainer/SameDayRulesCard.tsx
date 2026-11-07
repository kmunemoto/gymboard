import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

/**
 * 予約ポリシーの「当日」の2つのスイッチ（TrainerGymSettings の予約ポリシーに置く）。
 *
 * 1. 当日キャンセルを自動で消化扱いにする（`tenants.same_day_cancel_penalty_enabled`）
 *    もとは TrainerGymSettings に直接書いてあった。2. と並べるためにここへ移した（中身は同じ）。
 * 2. 当日の予約を、同じ日の後ろの時間へお客様が変更できる（`tenants.same_day_later_reschedule_enabled`・2026-11-07）
 *    宗本さん「当日予約してるお客様が、当日の後ろ限定で…後ろの時間で日時変更ができる設定を作ってほしい」。
 *    消化しない。決まりは `src/lib/sameDayReschedule.ts`、動かすのは DB の `move_booking_later_today`。
 *
 * 別ファイルなのは、TrainerGymSettings が行数の上限（`qualityRatchet.test.ts`）に達しているため
 * （`RemainingSlotsCard` と同じ形）。
 */
type SameDayColumn = "same_day_cancel_penalty_enabled" | "same_day_later_reschedule_enabled";

const SameDayRulesCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [saving, setSaving] = useState<SameDayColumn | null>(null);

  // 保存の案内はどちらも「予約ポリシーを更新しました／保存に失敗しました」（今までの文言のまま）
  const save = async (column: SameDayColumn, checked: boolean) => {
    if (!tenant) return;
    setSaving(column);
    const patch = column === "same_day_cancel_penalty_enabled"
      ? { same_day_cancel_penalty_enabled: checked }
      : { same_day_later_reschedule_enabled: checked };
    const { error } = await supabase.from("tenants").update(patch).eq("id", tenant.id);
    if (error) toast.error(t("settings.trainer.sameDayPenaltySaveFailed"));
    else {
      toast.success(t("settings.trainer.sameDayPenaltyUpdated"));
      refetchTenant();
    }
    setSaving(null);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-sm">{t("settings.trainer.sameDayPenaltyTitle")}</h4>
            <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.sameDayPenaltyDesc")}</p>
          </div>
          <Switch
            checked={!!tenant?.same_day_cancel_penalty_enabled}
            disabled={saving !== null || !tenant}
            onCheckedChange={(v) => save("same_day_cancel_penalty_enabled", v)}
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            <Label htmlFor="same-day-later-move" className="font-bold text-sm">
              {t("settings.trainer.sameDayLaterMoveTitle")}
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">{t("settings.trainer.sameDayLaterMoveDesc")}</p>
          </div>
          <Switch
            id="same-day-later-move"
            // `=== true` で見る。列が未適用の環境では undefined ＝オフ（今まで通り）に倒れる
            checked={tenant?.same_day_later_reschedule_enabled === true}
            disabled={saving !== null || !tenant}
            onCheckedChange={(v) => save("same_day_later_reschedule_enabled", v)}
            aria-label={t("settings.trainer.sameDayLaterMoveTitle")}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default SameDayRulesCard;
