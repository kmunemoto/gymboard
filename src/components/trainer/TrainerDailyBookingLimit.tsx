import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarX, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { weeklyPeakEnabled, weeklyPeakSaveValues } from "@/lib/weeklyPeak";
import { minBaseLimit, parseWeekdayLimits, weekdayLimitsToJson } from "@/lib/weekdayLimits";
import WeekdayLimitFields from "@/components/trainer/WeekdayLimitFields";

/** 「上限なし」を表す Select の値。空文字は Radix の Select が受け付けないため文字列を使う。 */
const NO_LIMIT = "__none__";

const LIMIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];

/** 上限を増やせる日数（週に）。7日すべてなら会員の上限そのものを上げればよいので 6 まで（DB も 1〜6） */
const PEAK_DAY_OPTIONS = [1, 2, 3, 4, 5, 6];

const toSelectValue = (n: number | null | undefined): string =>
  typeof n === "number" && n >= 1 ? String(n) : NO_LIMIT;

/**
 * 1日に受ける予約の上限件数（`tenants.daily_booking_limit`）。
 *
 * 実店舗の要望（2026-09-01 宗本さん）:「1日に見られる人数に限りがある。
 * 上限に達したら、枠が空いていてもその日の受付を止めたい」。
 *
 * 曜日ごとにも変えられる（`daily_booking_limit_weekdays`・2026-10-28）。2026-09-01 には
 * 「毎日おなじ1つの数字。曜日で変えたい日は予定表から手で止める」と決めていたが、
 * 宗本さん「曜日ごとに上限設定できる様にもして」で改めた。「曜日ごとに変える」を ON にした店だけ。
 * 「共通」の曜日は上の1日の上限。体験込みの合計（下の数字）は全曜日同じ（確認済み）。
 *
 * 🔴 店側の代理予約には効かない。上限に達した日でも、予定表から手で入れる分は通る。
 *    最終判定は DB（`tenant_day_closed` / GB007）。
 *
 * ## 体験も含めた合計の上限（`tenants.daily_total_limit`・2026-10-14）
 *
 * 宗本さん「一日4枠までしか取れませんが、体験の予約ではそれ以上取れます。体験予約も
 * その日がすでに5枠埋まっていれば体験予約も取れない様にしたい」→ 会員も合計5で止める、
 * 「その日だけ上限を外す」日は両方外す、と確認済み。
 *
 * 上の数字（会員だけを数える）はそのまま。下の数字は会員＋体験の合計で、達した日は
 * 会員も体験も受け付けない。会員の上限より大きくすると、その差の分だけ体験を受けられる。
 * 判定は DB の `tenant_day_total_reached` 1か所（体験予約ページ・会員の画面も同じ関数で数える）。
 *
 * ## 週に何日かだけ上限を増やす（`weekly_peak_days` / `weekly_peak_limit`・2026-10-22）
 *
 * 宗本さん「基本一日5枠までにして、週に2日5枠が埋まったら他の曜日は4枠までにする」。
 * 週は月曜〜日曜。体験は数えず、合計の上限はそのまま効く（確認済み）。
 * 「週に◯日まで」と「◯人まで」の両方を選んだときだけ効く。人数は会員の上限より大きいものだけ選べる。
 * 判定は DB の `tenant_member_day_limits`（src/lib/weeklyPeak.ts は予定表の表示用の写し）。
 */
const TrainerDailyBookingLimit = () => {
  const { t } = useTranslation();
  const { tenant, refetch: refetchTenant } = useTenant();
  const [value, setValue] = useState<string>(NO_LIMIT);
  const [totalValue, setTotalValue] = useState<string>(NO_LIMIT);
  const [peakDays, setPeakDays] = useState<string>(NO_LIMIT);
  const [peakLimit, setPeakLimit] = useState<string>(NO_LIMIT);
  const [weekdayOn, setWeekdayOn] = useState(false);
  const [weekdays, setWeekdays] = useState<(number | null)[]>(() => Array(7).fill(null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const current = tenant?.daily_booking_limit;
    setValue(typeof current === "number" && current >= 1 ? String(current) : NO_LIMIT);
  }, [tenant?.daily_booking_limit]);

  useEffect(() => {
    const current = tenant?.daily_total_limit;
    setTotalValue(typeof current === "number" && current >= 1 ? String(current) : NO_LIMIT);
  }, [tenant?.daily_total_limit]);

  useEffect(() => {
    const parsed = parseWeekdayLimits(tenant?.daily_booking_limit_weekdays);
    setWeekdayOn(parsed !== null);
    setWeekdays(parsed ?? Array(7).fill(null));
  }, [tenant?.daily_booking_limit_weekdays]);

  useEffect(() => {
    // 🔴 効いていない週の設定（人数が1日の上限以下・1日の上限なし）は「増やさない」として見せる。
    //    古い版の画面で1日の上限だけ上げると残り、そのまま見せると保存のたびに
    //    「人数を選んでください」で止まる（2026-10-26: 1日の上限5・週の設定5人/2日が残っていた）。
    //    保存すれば NULL に片付く。判定（DB の tenant_member_day_limits）も効いていない扱い。
    const active = weeklyPeakEnabled({
      dailyLimit: tenant?.daily_booking_limit ?? null,
      peakLimit: tenant?.weekly_peak_limit ?? null,
      peakDays: tenant?.weekly_peak_days ?? null,
      weekdayLimits: parseWeekdayLimits(tenant?.daily_booking_limit_weekdays),
    });
    setPeakDays(active ? toSelectValue(tenant?.weekly_peak_days) : NO_LIMIT);
    setPeakLimit(active ? toSelectValue(tenant?.weekly_peak_limit) : NO_LIMIT);
  }, [tenant?.weekly_peak_days, tenant?.weekly_peak_limit, tenant?.daily_booking_limit, tenant?.daily_booking_limit_weekdays]);

  const memberLimit = value === NO_LIMIT ? null : parseInt(value, 10);
  const weekdayLimits = weekdayOn ? weekdays : null;
  // 増やした日の人数は、いちばん少ない曜日の上限より大きいものだけ（曜日ごとでなければ会員の上限）
  const minBase = minBaseLimit(memberLimit, weekdayLimits);
  const peakLimitOptions = minBase === null ? [] : LIMIT_OPTIONS.filter((n) => n > minBase);

  const handleSave = async () => {
    if (!tenant) return;
    const next = memberLimit;
    const nextTotal = totalValue === NO_LIMIT ? null : parseInt(totalValue, 10);
    // 「週に◯日まで」を選んでいなければ、人数が残っていても増やさない（両方そろって初めて効く）
    const peak = weeklyPeakSaveValues(
      next,
      peakDays === NO_LIMIT ? null : parseInt(peakDays, 10),
      peakLimit === NO_LIMIT ? null : parseInt(peakLimit, 10),
      weekdayLimits,
    );
    if (peak === "invalid") {
      toast.error(t("closedDays.peakInvalid"));
      return;
    }
    // 曜日ごと: OFF なら NULL（全曜日共通）。どの曜日も「共通」のままでも NULL。
    // 使っていない店（OFF のまま・保存済みの値も無い）は列に触らない（今まで通りの書き込み）
    const weekdayJson = weekdayLimitsToJson(weekdayLimits);
    const touchWeekdays = weekdayOn || parseWeekdayLimits(tenant.daily_booking_limit_weekdays) !== null;
    setSaving(true);
    const { error } = await supabase
      .from("tenants")
      .update({
        daily_booking_limit: next,
        daily_total_limit: nextTotal,
        ...peak,
        ...(touchWeekdays ? { daily_booking_limit_weekdays: weekdayJson } : {}),
      } as never)
      .eq("id", tenant.id);
    if (error) {
      console.error("1日の上限人数の保存に失敗:", error);
      toast.error(t("closedDays.limitSaveFailed"), { description: error.message });
    } else {
      toast.success(t("closedDays.limitSaved"));
      refetchTenant();
    }
    setSaving(false);
  };

  return (
    <>
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <CalendarX className="w-3.5 h-3.5" />
        {t("closedDays.limitSection")}
      </h3>
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-muted-foreground">{t("closedDays.limitDesc")}</p>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("closedDays.limitLabel")}</Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger className="h-10" aria-label={t("closedDays.limitLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LIMIT}>{t("closedDays.limitNone")}</SelectItem>
                {LIMIT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("closedDays.limitUnit", { count: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <WeekdayLimitFields
            enabled={weekdayOn}
            onEnabledChange={setWeekdayOn}
            values={weekdays}
            onChange={setWeekdays}
            commonLimit={memberLimit}
            options={LIMIT_OPTIONS}
          />
          <div className="space-y-1.5" data-testid="weekly-peak">
            <Label className="text-xs font-bold">{t("closedDays.peakLabel")}</Label>
            <div className="grid grid-cols-2 gap-2">
              <Select value={peakDays} onValueChange={setPeakDays} disabled={minBase === null}>
                <SelectTrigger className="h-10" aria-label={t("closedDays.peakDaysAria")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LIMIT}>{t("closedDays.peakNone")}</SelectItem>
                  {PEAK_DAY_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t("closedDays.peakDaysUnit", { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={peakLimit} onValueChange={setPeakLimit} disabled={minBase === null || peakDays === NO_LIMIT}>
                <SelectTrigger className="h-10" aria-label={t("closedDays.peakLimitAria")}>
                  <SelectValue placeholder={t("closedDays.peakLimitPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_LIMIT}>{t("closedDays.peakLimitPlaceholder")}</SelectItem>
                  {peakLimitOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {t("closedDays.limitUnit", { count: n })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{t("closedDays.peakDesc")}</p>
            {weekdayOn && <p className="text-xs text-muted-foreground">{t("closedDays.peakDescWeekday")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t("closedDays.totalLimitLabel")}</Label>
            <Select value={totalValue} onValueChange={setTotalValue}>
              <SelectTrigger className="h-10" aria-label={t("closedDays.totalLimitLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LIMIT}>{t("closedDays.limitNone")}</SelectItem>
                {LIMIT_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t("closedDays.limitUnit", { count: n })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("closedDays.totalLimitDesc")}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t("closedDays.limitProxyNote")}</p>
          <Button onClick={handleSave} disabled={saving || !tenant} size="sm" className="h-10">
            <Save className="w-4 h-4 mr-1" />
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </CardContent>
      </Card>
    </>
  );
};

export default TrainerDailyBookingLimit;
