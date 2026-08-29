import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { EMAIL_NOTE_MAX_LENGTH, normalizeEmailNote } from "@/lib/emailNotes";

// 体験メール（確認・前日リマインド）の「キャンセル・変更」欄の文章
// （tenants.trial_email_cancel_note）。固定文をやめ、店の文章にできる（2026-08-26）。
//
// 🔴 設定した場合は**その文章だけ**が出る（ジムのメールアドレスのリンクも自動では
//    足さない。「お電話ください」と書いたのに mailto が残る食い違いを作らないため）。
//    空欄なら従来の固定文＋リンクで、何も変わらない。
//
// TrainerGymSettings の「体験予約」カテゴリーに置く。別ファイルなのは
// TrainerGymSettings が行数の上限（qualityRatchet.test.ts）に達しているため。
const TrialCancelNoteCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNote(tenant?.trial_email_cancel_note ?? "");
  }, [tenant?.trial_email_cancel_note]);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    // 空欄は NULL（＝従来の固定文＋ジムのメールアドレスへの案内に戻る）。
    // 上限500はメールの店別文言と共通（normalizeEmailNote が切る。DB の CHECK と同値）。
    const { error } = await supabase
      .from("tenants")
      .update({ trial_email_cancel_note: normalizeEmailNote(note) } as never)
      .eq("id", tenant.id);
    if (error) {
      // 失敗理由（例: カラム未追加＝マイグレーション未適用）を画面でも確認できるようにする
      console.error("体験メールのキャンセル案内の保存に失敗:", error);
      toast.error(t("settings.trainer.trialCancelNoteSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.trialCancelNoteSaved"));
      refetchTenant();
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">{t("settings.trainer.trialCancelNoteDesc")}</p>
        <div className="space-y-1.5">
          <Label htmlFor="trial-cancel-note" className="text-xs font-bold">{t("settings.trainer.trialCancelNoteLabel")}</Label>
          <Textarea
            id="trial-cancel-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("settings.trainer.trialCancelNotePlaceholder")}
            rows={3}
            maxLength={EMAIL_NOTE_MAX_LENGTH}
          />
          {note.trim() === "" && (
            <p className="text-[11px] text-muted-foreground">{t("settings.trainer.trialCancelNoteUnset")}</p>
          )}
        </div>
        <Button onClick={handleSave} disabled={saving || !tenant} size="sm" className="h-10">
          <Save className="w-4 h-4 mr-1" />
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </CardContent>
    </Card>
  );
};

export default TrialCancelNoteCard;
