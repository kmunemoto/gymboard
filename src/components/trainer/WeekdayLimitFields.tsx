import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { WEEKDAY_ORDER } from "@/lib/weekdayLimits";

/** 「共通」（1日の上限と同じ）を表す Select の値。空文字は Radix の Select が受け付けない */
const COMMON = "__common__";

interface Props {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  /** 7曜日の上限（添字は曜日。0=日曜〜6=土曜）。null は共通 */
  values: ReadonlyArray<number | null>;
  onChange: (values: (number | null)[]) => void;
  /** 共通の上限（1日の上限）。null=上限なし */
  commonLimit: number | null;
  options: readonly number[];
}

/**
 * 曜日ごとの会員の1日の上限（2026-10-28・src/lib/weekdayLimits.ts）。
 *
 * 宗本さん「曜日ごとに上限設定できる様にもして」。曜日ごとに人数を選ぶ。「共通」の曜日は
 * 1日の上限のまま。並びは月曜〜日曜（「週に何日か増やす」の週と同じ）。
 * 決めても DB にはまだ書かない。カードの「保存」で、ほかの項目と一緒に書く。
 */
const WeekdayLimitFields = ({ enabled, onEnabledChange, values, onChange, commonLimit, options }: Props) => {
  const { t } = useTranslation();
  const commonLabel = commonLimit === null ? t("closedDays.limitNone") : t("closedDays.limitUnit", { count: commonLimit });
  const setDay = (day: number, value: string) =>
    onChange(values.map((v, d) => (d === day ? (value === COMMON ? null : parseInt(value, 10)) : v)));

  return (
    <div className="space-y-2" data-testid="weekday-limits">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="weekday-limits-toggle" className="text-xs font-bold">{t("closedDays.weekdayToggle")}</Label>
        <Switch id="weekday-limits-toggle" checked={enabled} onCheckedChange={onEnabledChange} />
      </div>
      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {WEEKDAY_ORDER.map((day) => {
              const dayLabel = t(`progress.dow${day}`);
              const v = values[day];
              return (
                <div key={day} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-center text-sm font-bold">{dayLabel}</span>
                  <Select value={v == null ? COMMON : String(v)} onValueChange={(next) => setDay(day, next)}>
                    <SelectTrigger className="h-10 min-w-0" aria-label={t("closedDays.weekdayAria", { day: dayLabel })}>
                      {/* スマホの幅では「共通（5人まで）」が切れるので、閉じているときは「共通」だけ（値はすぐ上の1日の上限） */}
                      <SelectValue>
                        {v == null ? t("closedDays.weekdayCommonShort") : t("closedDays.limitUnit", { count: v })}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={COMMON}>{t("closedDays.weekdayCommon", { limit: commonLabel })}</SelectItem>
                      {options.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {t("closedDays.limitUnit", { count: n })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t("closedDays.weekdayDesc")}</p>
        </>
      )}
    </div>
  );
};

export default WeekdayLimitFields;
