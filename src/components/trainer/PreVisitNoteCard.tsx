import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, Save, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import PreVisitNote from "@/components/booking/PreVisitNote";
import { PRE_VISIT_NOTE_MAX, normalizePreVisitNote } from "@/lib/preVisitNote";

/**
 * お客様に伝える「ご来店前のお願い」（`tenants.pre_visit_note`・2026-10-27）。
 *
 * 宗本さん「お客様にトレーニング前の１～２時間前にエネルギーになるものを摂取して
 * お越しくださいという意味の文章を伝えたい」。文は店が自由に書く。空なら出さない。
 * 例文はボタンで入れるだけ（上流が文言を代弁しない。保存するまでお客様には出ない）。
 *
 * 置き場は TrainerGymSettings の予約のルール（「来店の目安時刻」の隣）。別ファイルなのは、
 * あのファイルが行数の上限（`qualityRatchet.test.ts`）に達しているため。
 */
const PreVisitNoteCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(tenant?.pre_visit_note ?? "");
  }, [tenant?.pre_visit_note]);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({ pre_visit_note: normalizePreVisitNote(value) } as never)
      .eq("id", tenant.id);
    if (error) {
      console.error("ご来店前のお願いの保存に失敗:", error);
      toast.error(t("settings.trainer.preVisitSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.preVisitSaved"));
      refetchTenant();
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="pre-visit-note" className="text-sm font-bold flex items-center gap-1.5">
            <Info className="w-4 h-4 text-accent" />
            {t("settings.trainer.preVisitLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("settings.trainer.preVisitDesc")}</p>
        </div>
        <Textarea
          id="pre-visit-note"
          rows={4}
          maxLength={PRE_VISIT_NOTE_MAX}
          value={value}
          placeholder={t("settings.trainer.preVisitPlaceholder")}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setValue(t("settings.trainer.preVisitTemplate"))}
          >
            <Wand2 className="w-3.5 h-3.5 mr-1" />
            {t("settings.trainer.preVisitUseTemplate")}
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">{value.length}/{PRE_VISIT_NOTE_MAX}</span>
        </div>
        {/* 保存前でも、お客様に何と出るかが分かるように同じ部品で見本を出す */}
        {normalizePreVisitNote(value) && (
          <div className="space-y-1" data-testid="pre-visit-preview">
            <p className="text-xs text-muted-foreground">{t("settings.trainer.preVisitPreview")}</p>
            <PreVisitNote note={value} />
          </div>
        )}
        <Button onClick={handleSave} disabled={saving || !tenant} size="sm" className="h-10">
          <Save className="w-4 h-4 mr-1" />
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </CardContent>
    </Card>
  );
};

export default PreVisitNoteCard;
