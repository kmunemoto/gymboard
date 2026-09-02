import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { format, addDays, isSameDay } from "date-fns";
import { ja } from "date-fns/locale";
import { getJSTNow } from "@/lib/timezone";
import { BookingWithTime, SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";
import { getBookingProgressIndex, resolveCycleMonths, resolveCycleUnit, resolveGraceDays, type BookingForProgress } from "@/lib/courseProgress";
import { timelineHourRange } from "@/lib/businessHours";
import { summarizeOptions } from "@/lib/bookingOptions";

export interface ProfileLite {
  user_id: string;
  plan: string | null;
  cycle_start_date: string | null;
  /** 起算日を店の設定で固定しているか。省略は未固定扱い */
  cycle_start_pinned?: boolean | null;
  /** 猶予（大目に見る）をこのお客様に適用するか。null/true=適用（既定） */
  grace_enabled?: boolean | null;
}

interface WeekTimelineViewProps {
  weekStart: Date;
  bookings: BookingWithTime[];
  onSelectBooking?: (booking: BookingWithTime) => void;
  profiles?: ProfileLite[];
  /** サイクル月数・単位の解決用（プランごとの利用期間）。 */
  tenantPlans?: ReadonlyArray<{ plan_name: string; cycle_months?: number | null; cycle_unit?: string | null }>;
  /** 営業時間（tenants.operating_hours）。時間軸の範囲に使う。 */
  operatingHours?: { start?: string | null; end?: string | null } | null;
  /**
   * 日付ヘッダに出す「その日の受付を止める／解除する」スイッチ。
   *
   * 🔴 このビューは**既定の表示**なので、ここに無いとワンタップにならない
   *    （日別へ切り替えてから押す、では要望を満たさない。2026-09-01 に実機相当の
   *    画面で確認して気づいた）。データの出し入れは親（TrainerSchedule）が持ち、
   *    ここは受け取った関数を呼ぶだけにする。
   */
  renderDayReception?: (dateKey: string) => ReactNode;
}

// 🔴 以前は START_HOUR = 9 / END_HOUR = 22 が直書きされていて、
// 営業時間を何時にしても 9:00〜22:00 の外はスクロールできなかった
// （2026-08-18 に宗本さんが実機で発見）。営業時間から求めること。
const SLOT_MIN = 30; // グリッドの単位（30分）
const PX_PER_HOUR = 56; // 1時間 = 56px
const PX_PER_MIN = PX_PER_HOUR / 60;

const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const WeekTimelineView = ({ weekStart, bookings, onSelectBooking, profiles = [], tenantPlans = [], operatingHours, renderDayReception }: WeekTimelineViewProps) => {
  const { t } = useTranslation();
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // user_id ごとの予約一覧（進捗計算用）
  const bookingsByUser = new Map<string, BookingForProgress[]>();
  bookings
    .filter((b) => b.user_id !== "trial-guest" && b.user_id !== "blocked" && !b.isBlocked)
    .forEach((b) => {
      const rows = bookingsByUser.get(b.user_id) || [];
      rows.push({
        id: b.id,
        booking_date: `${b.date}T${b.startTime}:00+09:00`,
        status: b.status,
      });
      bookingsByUser.set(b.user_id, rows);
    });
  // 営業時間から時間軸を作る。表示中の予約が営業時間の外にあっても、
  // 軸を広げて必ず見えるようにする（狭めた途端に予約が消えるのを防ぐ）。
  const visible = bookings.filter(
    (b) => b.status !== "キャンセル済み" && b.status !== SAME_DAY_FORFEIT_STATUS,
  );
  const { startHour: START_HOUR, endHour: END_HOUR } = timelineHourRange(
    operatingHours,
    visible.map((b) => ({ start: timeToMin(b.startTime), end: timeToMin(b.endTime) })),
  );
  const totalMinutes = (END_HOUR - START_HOUR) * 60;
  const totalHeight = totalMinutes * PX_PER_MIN;

  const hours: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) hours.push(h);

  const halfSlots: number[] = [];
  for (let m = 0; m < totalMinutes; m += SLOT_MIN) halfSlots.push(m);

  // 現在時刻 (JST)
  const [now, setNow] = useState(getJSTNow());
  useEffect(() => {
    const id = setInterval(() => setNow(getJSTNow()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowOffset = (nowMin - START_HOUR * 60) * PX_PER_MIN;
  const showNowLine = nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60;

  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      {/* ヘッダー（曜日） */}
      <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] border-b bg-muted/95 backdrop-blur sticky top-0 z-30">
        <div className="p-1.5 text-[10px] text-muted-foreground text-center font-semibold">時間</div>
        {weekDays.map((day) => {
          const isToday = isSameDay(day, now);
          return (
            <div
              key={day.toISOString()}
              className={`p-1.5 text-center border-l ${isToday ? "bg-accent/10" : ""}`}
            >
              <p className={`text-[10px] font-semibold uppercase ${isToday ? "text-accent" : "text-muted-foreground"}`}>
                {format(day, "EEE", { locale: ja })}
              </p>
              <p className={`text-xs sm:text-sm font-bold ${isToday ? "text-accent" : ""}`}>
                {format(day, "M/d")}
              </p>
              {renderDayReception && (
                <div className="mt-0.5">{renderDayReception(format(day, "yyyy-MM-dd"))}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* タイムライン本体（ページ自体でスクロール） */}
      <div
        className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] relative"
        style={{ height: totalHeight }}
      >
          {/* 時間軸（左カラム） */}
          <div className="relative border-r">
            {hours.map((h) => {
              const top = (h - START_HOUR) * PX_PER_HOUR;
              return (
                <div
                  key={h}
                  className="absolute right-1 text-[10px] text-muted-foreground -translate-y-1/2"
                  style={{ top }}
                >
                  {String(h).padStart(2, "0")}:00
                </div>
              );
            })}
          </div>

          {/* 各曜日カラム */}
          {weekDays.map((day) => {
            const isToday = isSameDay(day, now);
            const dateStr = format(day, "yyyy-MM-dd");
            // 同日キャンセル消化(SAME_DAY_FORFEIT_STATUS)の予約は予定表からは非表示にする
            // （枠は占有されたまま・消化数カウントには含まれる。bookingsByUser 側は非フィルタのまま）。
            const dayBookings = bookings.filter(
              (b) => b.date === dateStr && b.status !== "キャンセル済み" && b.status !== SAME_DAY_FORFEIT_STATUS
            );

            return (
              <div
                key={day.toISOString()}
                className={`relative border-l ${isToday ? "bg-accent/5" : ""}`}
              >
                {/* 30分ごとのグリッド線 */}
                {halfSlots.map((m) => {
                  const top = m * PX_PER_MIN;
                  const isHour = m % 60 === 0;
                  return (
                    <div
                      key={m}
                      className={`absolute left-0 right-0 border-t ${isHour ? "border-border" : "border-border/40 border-dashed"}`}
                      style={{ top }}
                    />
                  );
                })}

                {/* 予約カード */}
                {dayBookings.map((b) => {
                  const startMin = timeToMin(b.startTime);
                  const endMin = timeToMin(b.endTime);
                  const top = (startMin - START_HOUR * 60) * PX_PER_MIN;
                  const height = Math.max(20, (endMin - startMin) * PX_PER_MIN - 2);
                  if (top + height < 0 || top > totalHeight) return null;

                  const shortName = b.isBlocked
                    ? "—"
                    : b.clientName.replace(/^[^A-Za-z\u3040-\u30FF\u4E00-\u9FFF]+/, "").slice(0, 3);

                  // オプション付きの予約。狭すぎて名前は出せないので、色・左の帯・「＋」印で示し、
                  // 名前はツールチップ（title）に入れる。
                  const optionText = summarizeOptions(
                    b.bookingOptions, (m) => t("bookingOptions.pickerPlusMinutes", { count: m }),
                  );
                  const hasOptions = !b.isBlocked && optionText.length > 0;

                  const profile = profiles.find((p) => p.user_id === b.user_id);
                  const progress =
                    !b.isBlocked && profile
                      ? getBookingProgressIndex(
                          b.id,
                          profile.cycle_start_date,
                          profile.plan,
                          bookingsByUser.get(b.user_id) || [],
                          resolveCycleMonths(profile.plan, tenantPlans),
                          resolveGraceDays(profile.plan, tenantPlans, profile.grace_enabled),
                          resolveCycleUnit(profile.plan, tenantPlans),
                          profile.cycle_start_pinned,
                        )
                      : null;
                  const progressLabel = progress
                    ? progress.isUnlimited
                      ? `${progress.index}回目`
                      : progress.isUnconfigured || progress.total === null
                        ? null
                        : `${progress.index}/${progress.total}${progress.isGraceCarryover ? ` ${t("courseBadge.graceCarryoverShort")}` : ""}`
                    : null;

                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onSelectBooking?.(b)}
                      className={`absolute left-0.5 right-0.5 rounded-md px-1 py-0.5 text-left overflow-hidden text-[10px] leading-tight shadow-sm transition-transform hover:scale-[1.02] hover:z-10 ${
                        b.isBlocked
                          ? "bg-muted border border-dashed border-destructive/40 text-muted-foreground"
                          : hasOptions
                            // 🔴 オプション付きは色で区別する（2026-09-03 宗本さん。ここは幅が
                            //    数文字ぶんしかなく、名前を出す場所が無い）。左の帯＋印の2つで
                            //    示すのは、色だけだと色覚や画面の明るさで区別できない人がいるため。
                            ? "bg-primary text-primary-foreground border-l-4 border-l-warning"
                            : "bg-accent text-accent-foreground"
                      }`}
                      style={{ top, height }}
                      title={`${b.clientName} ${b.startTime}〜${b.endTime}${progressLabel ? ` (${progressLabel})` : ""}${optionText ? ` ＋${optionText}` : ""}`}
                    >
                      <div className="font-bold truncate">
                        {shortName}
                        {hasOptions && <span className="ml-0.5" aria-hidden="true">＋</span>}
                      </div>
                      {height > 24 && (
                        <div className="opacity-80 truncate">{b.startTime}</div>
                      )}
                      {progressLabel && height > 38 && (
                        <div className="opacity-90 truncate font-semibold">{progressLabel}</div>
                      )}
                    </button>
                  );
                })}

                {/* 現在時刻の赤線（今日のみ） */}
                {isToday && showNowLine && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: nowOffset }}
                  >
                    <div className="h-[2px] bg-destructive" />
                    <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-destructive" />
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default WeekTimelineView;