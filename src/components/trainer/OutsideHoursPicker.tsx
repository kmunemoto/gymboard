import { useTranslation } from "react-i18next";
import { AlertTriangle, Moon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { minutesToTime, type OperatingHours } from "@/lib/businessHours";
import { endTimeOf, outsideHoursStarts } from "@/lib/outsideHours";
import { formatDate } from "@/lib/dateFormat";

/**
 * 代理予約の「営業時間外・定休日に入れる（イレギュラー）」（2026-10-17）。計算は src/lib/outsideHours.ts。
 *
 * TrainerSchedule.tsx は行数の上限に近いので、スイッチ・時刻の選択・確認の文言をここに置く。
 * 予約そのもの（重なりの確認・作成）は TrainerSchedule の代理予約と同じ経路を通る。
 */

/** 代理予約の画面の上に置くスイッチ。ON の間は定休日も選べ、時刻は営業時間外だけを並べる */
export const OutsideHoursToggle = ({ checked, onChange, disabled }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
      <div className="min-w-0">
        <p className="text-xs font-bold flex items-center gap-1">
          <Moon className="w-3.5 h-3.5 text-accent" />
          {t("schedule.outsideHoursToggle")}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{t("schedule.outsideHoursToggleDesc")}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={t("schedule.outsideHoursToggle")} />
    </div>
  );
};

interface PickerProps {
  dateKey: string;
  operatingHours: OperatingHours | null | undefined;
  /** プランの長さ＋オプション（分） */
  sessionMinutes: number;
  /** 選んだ開始時刻 "HH:mm"（未選択は ""） */
  value: string;
  onChange: (time: string) => void;
  /** その時刻だと他の予約・ブロックと重なるか（代理予約の枠と同じ判定を呼び出し側で渡す） */
  isBlocked: (time: string) => boolean;
  /** 予約ボタンを1回押したあと（もう一度押すと入る）。時刻の打ち間違いを防ぐための確認 */
  confirming: boolean;
}

/** 営業時間外の開始時刻を選ぶ。開店前／閉店後（定休日は1日中）に分けて並べる */
export const OutsideHoursPicker = ({ dateKey, operatingHours, sessionMinutes, value, onChange, isBlocked, confirming }: PickerProps) => {
  const { t } = useTranslation();
  const starts = outsideHoursStarts(operatingHours, dateKey, sessionMinutes);
  const sections = starts.closedDay
    ? [{ key: "closed", label: t("schedule.outsideHoursClosedDay"), times: starts.after }]
    : [
        { key: "before", label: t("schedule.outsideHoursBefore"), times: starts.before },
        { key: "after", label: t("schedule.outsideHoursAfter"), times: starts.after },
      ].filter((s) => s.times.length > 0);
  const selectedMin = value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;
  return (
    <div className="space-y-3" data-testid="outside-hours-picker">
      {sections.length === 0 && <p className="text-xs text-muted-foreground">{t("schedule.outsideHoursNone")}</p>}
      {sections.map((s) => (
        <div key={s.key}>
          <p className="text-[11px] font-bold text-muted-foreground mb-1.5">{s.label}</p>
          <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
            {s.times.map((m) => {
              const time = minutesToTime(m);
              const blocked = isBlocked(time);
              return (
                <button
                  key={time}
                  type="button"
                  disabled={blocked}
                  onClick={() => onChange(time)}
                  className={`rounded-lg p-2.5 text-xs font-semibold transition-all min-h-[44px] ${
                    blocked
                      ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                      : value === time
                        ? "accent-gradient text-accent-foreground shadow-md"
                        : "bg-card border border-border hover:border-accent"
                  }`}
                >
                  {time}
                  {blocked && <span className="block text-[9px] text-destructive/70">{t("schedule.slotFull")}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {selectedMin !== null && (
        confirming ? (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3" data-testid="outside-hours-confirm">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed">
              {t("schedule.outsideHoursConfirm", {
                date: formatDate(new Date(`${dateKey}T00:00:00`), "monthDayDow"),
                start: value,
                end: endTimeOf(selectedMin, sessionMinutes),
              })}
            </p>
          </div>
        ) : (
          <p className="text-xs font-bold text-center">{value}〜{endTimeOf(selectedMin, sessionMinutes)}</p>
        )
      )}
    </div>
  );
};

/**
 * 予定表の予約に付ける小さな印。
 * PC の表の予約は塗りつぶし（accent-gradient）、スマホの一覧は白いカードなので、どちらの上でも読める濃い色にする。
 */
export const OutsideHoursBadge = () => {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold bg-foreground text-background" data-testid="outside-hours-badge">
      <Moon className="w-2.5 h-2.5" />
      {t("schedule.outsideHoursBadge")}
    </span>
  );
};
