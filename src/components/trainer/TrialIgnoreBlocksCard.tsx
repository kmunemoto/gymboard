import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";

/**
 * 体験予約だけ、予定表の「時間ブロック」を無視して受けるか
 * （`tenants.trial_ignores_blocked_slots`。既定 OFF）。
 *
 * 実店舗の要望（2026-09-14 宗本さん）:
 *
 * > 体験予約はお店のブロックを無視して予約できるように設定できる、
 * > オンオフの機能を追加してほしい。……時間ブロックです。
 *
 * ## 🔴 何を無視して、何を無視しないか
 *
 * | | ON のとき |
 * |---|---|
 * | 予定表の「時間ブロック」 | **無視する**（体験だけ） |
 * | 他の予約との重なり（同時受入数） | 効く |
 * | 営業時間・定休日・予約の締切 | 効く |
 * | 会員予約・店の代理予約 | **一切変わらない**（ブロックで塞がれたまま） |
 * | ドロップイン | **一切変わらない**（体験と同じ表に入るが、対象外） |
 *
 * ## ジム設定の「受付しない時間帯」とは別物
 *
 * あちら（`blocked_windows`）は体験予約に**元々効いていない**。
 * ここで扱うのは予定表の「時間ブロック」ボタンで作る `blocked_slots` のほう。
 *
 * ## 置き場
 *
 * TrainerGymSettings の「体験予約」カテゴリー。別ファイルなのは
 * TrainerGymSettings が行数の上限（`qualityRatchet.test.ts`）に達しているため
 * （`TrialCancelNoteCard` と同じ理由・同じ形）。
 */
const TrialIgnoreBlocksCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();

  // 🔴 `=== true` で見る。列が未適用の環境では undefined になり、
  //    「ブロックは効いたまま」＝安全側に倒れる。
  const enabled = tenant?.trial_ignores_blocked_slots === true;

  const handleToggle = async (next: boolean) => {
    if (!tenant) return;
    const { error } = await supabase
      .from("tenants")
      .update({ trial_ignores_blocked_slots: next } as never)
      .eq("id", tenant.id);
    if (error) {
      // 失敗理由（例: カラム未追加＝マイグレーション未適用）を画面でも確認できるようにする
      console.error("体験予約のブロック無視設定の保存に失敗:", error);
      toast.error(t("settings.trainer.trialIgnoreBlocksSaveFailed"), { description: error.message });
      return;
    }
    toast.success(t("settings.trainer.trialIgnoreBlocksSaved"));
    refetchTenant();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="trial-ignore-blocks" className="text-sm font-bold">
              {t("settings.trainer.trialIgnoreBlocksLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.trainer.trialIgnoreBlocksDesc")}
            </p>
          </div>
          <Switch
            id="trial-ignore-blocks"
            checked={enabled}
            onCheckedChange={handleToggle}
            aria-label={t("settings.trainer.trialIgnoreBlocksLabel")}
          />
        </div>
        {enabled && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {t("settings.trainer.trialIgnoreBlocksWarning")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TrialIgnoreBlocksCard;
