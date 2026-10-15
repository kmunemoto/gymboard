import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { addDays, format } from "date-fns";
import { Info } from "lucide-react";
import type { PlanUsageBooking, PlanUsageInput } from "@/lib/planUsage";
import {
  calendarPeriods,
  inclusiveRange,
  periodDayHint,
  repeatPeriodBreak,
  type CalendarPeriodView,
  type PeriodDayHint,
} from "@/lib/calendarPeriod";
import { getJSTNow } from "@/lib/timezone";

/**
 * 予約カレンダーの「今回の利用期間」（2026-10-15）。計算は src/lib/calendarPeriod.ts。
 *
 * - 帯: 今回の期間のマスに薄い色、次の期間（決まっているときだけ）に別の薄い色を敷く。
 *   「満」「残N」・自分の予約の丸印・今日／選んだ日の塗りはそのまま見える（帯はマスの下地）
 * - 説明: カレンダーの下に「今回の利用期間 10/8〜11/8（あと2回予約できます）」
 * - 一言: 日を選んだとき、その日が次の期間の1回目などになるなら知らせる
 *
 * 🔴 お客様ごとの「利用期間の表示」（profiles.show_usage_period）が OFF のお客様には、
 *    帯・説明・一言のどれも出さない（期限を明かさない設定。カードと同じ）。
 */

/**
 * 帯の見た目。マス（td）の下地に色を付ける。カレンダーの外側の日（前後の月の日）には付けない。
 * クラス名は react-day-picker の modifiersClassNames で日のボタンに付く印。
 */
export const PERIOD_CALENDAR_CLASS = [
  "[&_td:has(.cal-period-current:not(.day-outside))]:bg-accent/15",
  "[&_td:has(.cal-period-next:not(.day-outside))]:bg-muted",
  "[&_td:has(.cal-period-start:not(.day-outside))]:rounded-l-lg",
  "[&_td:has(.cal-period-end:not(.day-outside))]:rounded-r-lg",
  "[&_td:first-child:has(.cal-period-current:not(.day-outside))]:rounded-l-lg",
  "[&_td:last-child:has(.cal-period-current:not(.day-outside))]:rounded-r-lg",
  "[&_td:first-child:has(.cal-period-next:not(.day-outside))]:rounded-l-lg",
  "[&_td:last-child:has(.cal-period-next:not(.day-outside))]:rounded-r-lg",
].join(" ");

const md = (d: Date) => format(d, "M/d");
/** 期間の最終日（end は含まないので、その前日） */
const lastDay = (end: Date) => addDays(end, -1);

export function useCalendarPeriod(
  input: PlanUsageInput | null | undefined,
  bookings: PlanUsageBooking[],
  showUsagePeriod: boolean | null | undefined,
  /** 日時の変更中なら、動かす予約（その予約を除いて「この日なら」を計算する） */
  moving?: { date: string; startTime: string } | null,
) {
  const { t } = useTranslation();
  const visible = showUsagePeriod !== false;
  const view = useMemo(
    () => (visible ? calendarPeriods(input, bookings, getJSTNow()) : null),
    [visible, input, bookings],
  );
  const dayPicker = useMemo(() => {
    const band = view?.currentBand ?? null;
    const next = view?.next ?? null;
    return {
      modifiers: {
        periodCurrent: band ? inclusiveRange(band) : [],
        periodNext: next ? inclusiveRange(next) : [],
        periodStart: [band?.start, next?.start].filter((d): d is Date => !!d),
        periodEnd: [band, next].filter((w): w is NonNullable<typeof w> => !!w).map((w) => lastDay(w.end)),
      },
      modifiersClassNames: {
        periodCurrent: "cal-period-current",
        periodNext: "cal-period-next",
        periodStart: "cal-period-start",
        periodEnd: "cal-period-end",
      },
    };
  }, [view]);
  // 変更中は、動かす予約を除いて「この日に予約したら」を計算する（残したままだと1回多く数える）
  const simBookings = useMemo(() => {
    if (!moving) return bookings;
    const iso = `${moving.date}T${moving.startTime}:00+09:00`;
    const i = bookings.findIndex((b) => b.booking_date === iso && b.status !== "キャンセル済み");
    return i < 0 ? bookings : bookings.filter((_, j) => j !== i);
  }, [bookings, moving]);
  const hintFor = useCallback(
    (dateKey: string): PeriodDayHint => (view && dateKey ? periodDayHint(input, simBookings, dateKey, view) : null),
    [view, input, simBookings],
  );
  const repeatNoteFor = useCallback((dateKey: string, weeks: number): string | null => {
    if (!view || !dateKey) return null;
    const hit = repeatPeriodBreak(input, simBookings, dateKey, weeks);
    if (!hit) return null;
    return t("booking.periodRepeatNote", { date: md(new Date(`${hit.dateKey}T00:00:00`)), n: hit.ordinal });
  }, [view, input, simBookings, t]);
  return { view, dayPicker, calendarClass: view ? PERIOD_CALENDAR_CLASS : "", hintFor, repeatNoteFor };
}

/** カレンダーの下の説明 */
export const CalendarPeriodLegend = ({ view }: { view: CalendarPeriodView | null }) => {
  const { t } = useTranslation();
  if (!view) return null;
  return (
    <div className="mt-2 space-y-1 text-[11px] text-muted-foreground" data-testid="calendar-period-legend">
      {view.current ? (
        <p className="flex items-center justify-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-accent/30" aria-hidden />
          <span>
            {t("booking.periodLegendCurrent", { start: md(view.current.start), end: md(lastDay(view.current.end)) })}
            {view.remaining != null && (
              <span className="ml-1 font-bold text-foreground">
                {view.remaining > 0
                  ? t("booking.periodLegendRemaining", { count: view.remaining })
                  : t("booking.periodLegendAllBooked")}
              </span>
            )}
          </span>
        </p>
      ) : (
        <p className="text-center">{t("booking.periodLegendPending")}</p>
      )}
      {view.next && (
        <p className="flex items-center justify-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-muted ring-1 ring-border" aria-hidden />
          <span>{t("booking.periodLegendNext", { start: md(view.next.start), end: md(lastDay(view.next.end)) })}</span>
        </p>
      )}
    </div>
  );
};

/** 日を選んだときの一言 */
export const CalendarPeriodHint = ({ hint }: { hint: PeriodDayHint }) => {
  const { t } = useTranslation();
  if (!hint) return null;
  const start = md(hint.period.start);
  const end = md(lastDay(hint.period.end));
  const text = hint.kind === "inPeriod"
    ? t("booking.periodHintInPeriod", { start, end, count: hint.count })
    : hint.afterCurrent
      ? t("booking.periodHintNext", { start, end })
      : t("booking.periodHintStart", { end });
  return (
    <div className="mb-3 flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3" data-testid="calendar-period-hint">
      <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
      <p className="text-xs text-foreground leading-relaxed">{text}</p>
    </div>
  );
};
