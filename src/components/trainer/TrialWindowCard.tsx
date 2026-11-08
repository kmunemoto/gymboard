import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { BOOKING_WINDOW_OPTIONS, normalizeBookingWindowDays } from "@/lib/bookingWindow";

/**
 * 体験予約を何日先まで受け付けるか（`tenants.trial_booking_window_days`・2026-11-08）。
 *
 * 宗本さん「体験の受付を2週間先までに延ばしたい」。
 * 「何日先まで予約を受け付けるか」（booking_window_days）は会員の予約と共通なので、そちらを14日にすると
 * 会員まで2週間に縮む。体験だけ延ばせるように分けた。
 *
 * - 未設定（null）＝今まで通り: 予約全体の設定と同じ（それも未設定なら10日先まで）
 * - 体験予約ページ（メニューの体験を含む）と trial-book に効く。会員の予約・ドロップインには効かない
 * - 選んだらすぐ保存する（TrialIgnoreBlocksCard と同じ）
 *
 * 決め方は `src/lib/bookingWindow.ts` の `trialBookingWindowDays`。
 * 置き場は TrainerGymSettings の「体験予約」カテゴリー（行数の上限のため別ファイル。TrialIgnoreBlocksCard と同じ形）。
 */
const UNSET = "unset";

const TrialWindowCard = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [saving, setSaving] = useState(false);

  const current = normalizeBookingWindowDays(tenant?.trial_booking_window_days);
  // 選択肢に無い値（SQL で入れた等）でも、今の値を選べる形で見せる
  const options: number[] = current !== null && !(BOOKING_WINDOW_OPTIONS as readonly number[]).includes(current)
    ? [...BOOKING_WINDOW_OPTIONS, current].sort((a, b) => a - b)
    : [...BOOKING_WINDOW_OPTIONS];

  const save = async (value: string) => {
    if (!tenant) return;
    const next = value === UNSET ? null : normalizeBookingWindowDays(Number(value));
    if (next === current) return;
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({ trial_booking_window_days: next })
      .eq("id", tenant.id);
    setSaving(false);
    if (error) {
      toast.error(t("settings.trainer.trialWindowSaveFailed"));
      return;
    }
    toast.success(t("settings.trainer.trialWindowSaved"));
    refetchTenant();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-1.5">
        <Label htmlFor="trial-booking-window" className="text-sm font-bold">{t("settings.trainer.trialWindowLabel")}</Label>
        <p className="text-xs text-muted-foreground">{t("settings.trainer.trialWindowDesc")}</p>
        <Select value={current === null ? UNSET : String(current)} onValueChange={save} disabled={saving || !tenant}>
          <SelectTrigger id="trial-booking-window" className="h-10" aria-label={t("settings.trainer.trialWindowLabel")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>{t("settings.trainer.trialWindowUnset")}</SelectItem>
            {options.map((d) => (
              <SelectItem key={d} value={String(d)}>{t("settings.trainer.bookingWindowDays", { count: d })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
};

export default TrialWindowCard;
