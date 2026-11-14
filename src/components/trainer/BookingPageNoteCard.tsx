import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import BookingPageNote from "@/components/booking/BookingPageNote";
import { BOOKING_PAGE_NOTE_MAX, normalizeBookingPageNote } from "@/lib/bookingPageNote";

/**
 * お客様の予約画面のいちばん上に出す「予約画面のご案内」（`tenants.booking_page_note`・2026-11-14）。
 *
 * 宗本さん「予約画面の一番上にも出せるようにして」。文は店が自由に書く。空なら出さない。
 * 例文は持たない（上流が文言を代弁しない。入力欄の薄い文字は例を見せるだけで保存されない）。
 *
 * 置き場は TrainerGymSettings の予約のルール（「ご来店前のお願い」の隣・VisitGuideCards）。
 */
const BookingPageNoteCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(tenant?.booking_page_note ?? "");
  }, [tenant?.booking_page_note]);

  const handleSave = async () => {
    if (!tenant) return;
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({ booking_page_note: normalizeBookingPageNote(value) } as never)
      .eq("id", tenant.id);
    if (error) {
      console.error("予約画面のご案内の保存に失敗:", error);
      toast.error(t("settings.trainer.bookingPageNoteSaveFailed"), { description: error.message });
    } else {
      toast.success(t("settings.trainer.bookingPageNoteSaved"));
      refetchTenant();
    }
    setSaving(false);
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="booking-page-note" className="text-sm font-bold flex items-center gap-1.5">
            <CalendarDays className="w-4 h-4 text-accent" />
            {t("settings.trainer.bookingPageNoteLabel")}
          </Label>
          <p className="text-xs text-muted-foreground">{t("settings.trainer.bookingPageNoteDesc")}</p>
        </div>
        <Textarea
          id="booking-page-note"
          rows={4}
          maxLength={BOOKING_PAGE_NOTE_MAX}
          value={value}
          placeholder={t("settings.trainer.bookingPageNotePlaceholder")}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="flex justify-end">
          <span className="text-xs text-muted-foreground tabular-nums">{value.length}/{BOOKING_PAGE_NOTE_MAX}</span>
        </div>
        {/* 保存前でも、お客様に何と出るかが分かるように同じ部品で見本を出す */}
        {normalizeBookingPageNote(value) && (
          <div className="space-y-1" data-testid="booking-page-note-preview">
            <p className="text-xs text-muted-foreground">{t("settings.trainer.preVisitPreview")}</p>
            <BookingPageNote note={value} />
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

export default BookingPageNoteCard;
