import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DoorOpen, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ARRIVAL_LEAD_OPTIONS, arrivalFromTime, normalizeArrivalLead } from "@/lib/arrivalGuide";

/** 「案内しない」を表す Select の値。空文字は Radix の Select が受け付けないため文字列を使う。 */
const NONE = "__none__";

/**
 * お客様に案内する「開始の何分前から来てよいか」（`tenants.arrival_lead_minutes`）。
 *
 * 宗本さん（2026-10-10）「予約を受けた時にお客様にセッション開始の5分前以内にお越しください。
 * のメッセージを伝えたい。10分前とかに来られると困るから」。
 *
 * 設定した店だけ、予約完了画面・ホームの次回の予約・体験予約の完了画面に
 * 「ご来店は 13:55 以降にお願いします」と出す（`src/lib/arrivalGuide.ts`）。既定は出さない。
 *
 * 置き場は TrainerGymSettings の予約のルール。別ファイルなのは、あのファイルが
 * 行数の上限（`qualityRatchet.test.ts`）に達しているため（`RemainingSlotsCard` と同じ形）。
 */
const ArrivalLeadCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [value, setValue] = useState<string>(NONE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const current = normalizeArrivalLead(tenant?.arrival_lead_minutes);
    setValue(current === null ? NONE : String(current));
  }, [tenant?.arrival_lead_minutes]);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    const next = value === NONE ? null : parseInt(value, 10);
    const { error } = await supabase
      .from("tenants")
      .update({ arrival_lead_minutes: next } as never)
      .eq("id", tenant.id);
    if (error) {
      console.error("来店の目安の保存に失敗:", error);
      toast.error(t("settings.trainer.arrivalLeadSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.arrivalLeadSaved"));
      refetchTenant();
    }
    setSaving(false);
  };

  // 画面で選んでいる値でそのまま見本を出す（保存前でも、お客様に何と出るかが分かる）
  const previewTime = value === NONE ? null : arrivalFromTime("14:00", parseInt(value, 10));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1">
          <Label className="text-sm font-bold flex items-center gap-1.5">
            <DoorOpen className="w-4 h-4 text-accent" />
            {t("settings.trainer.arrivalLeadLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("settings.trainer.arrivalLeadDesc")}</p>
        </div>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger className="h-10" aria-label={t("settings.trainer.arrivalLeadLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("settings.trainer.arrivalLeadNone")}</SelectItem>
            {ARRIVAL_LEAD_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {t("settings.trainer.arrivalLeadOption", { count: n })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {previewTime && (
          <p className="text-xs text-muted-foreground" data-testid="arrival-lead-preview">
            {t("settings.trainer.arrivalLeadPreview", { time: previewTime })}
          </p>
        )}
        <Button onClick={handleSave} disabled={saving || !tenant} size="sm" className="h-10">
          <Save className="w-4 h-4 mr-1" />
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </CardContent>
    </Card>
  );
};

export default ArrivalLeadCard;
