import { useEffect, useState } from "react";
import { format, addDays, isSameDay } from "date-fns";
import { ja } from "date-fns/locale";
import { getJSTNow } from "@/lib/timezone";
import { BookingWithTime } from "@/hooks/useBookings";
import { getBookingProgressIndex, type BookingForProgress } from "@/lib/courseProgress";

export interface ProfileLite {
  user_id: string;
  plan: string | null;
  cycle_start_date: string | null;
}

interface WeekTimelineViewProps {
  weekStart: Date;
  bookings: BookingWithTime[];
  onSelectBooking?: (booking: BookingWithTime) => void;
  profiles?: ProfileLite[];
}

const START_HOUR = 9;
const END_HOUR = 22; // 22:00 まで（最終予約終了想定）
const SLOT_MIN = 30; // グリッドの単位（30分）
const PX_PER_HOUR = 56; // 1時間 = 56px
const PX_PER_MIN = PX_PER_HOUR / 60;

const timeToMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const WeekTimelineView = ({ weekStart, bookings, onSelectBooking, profiles = [] }: WeekTimelineViewProps) => {
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
            const dayBookings = bookings.filter(
              (b) => b.date === dateStr && b.status !== "キャンセル済み"
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

                  const profile = profiles.find((p) => p.user_id === b.user_id);
                  const progress =
                    !b.isBlocked && profile
                      ? getBookingProgressIndex(
                          b.id,
                          profile.cycle_start_date,
                          profile.plan,
                          bookingsByUser.get(b.user_id) || [],
                        )
                      : null;
                  const progressLabel = progress
                    ? progress.isUnlimited
                      ? `${progress.index}回目`
                      : progress.isUnconfigured || progress.total === null
                        ? null
                        : `${progress.index}/${progress.total}`
                    : null;

                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onSelectBooking?.(b)}
                      className={`absolute left-0.5 right-0.5 rounded-md px-1 py-0.5 text-left overflow-hidden text-[10px] leading-tight shadow-sm transition-transform hover:scale-[1.02] hover:z-10 ${
                        b.isBlocked
                          ? "bg-muted border border-dashed border-destructive/40 text-muted-foreground"
                          : "bg-accent text-accent-foreground"
                      }`}
                      style={{ top, height }}
                      title={`${b.clientName} ${b.startTime}〜${b.endTime}${progressLabel ? ` (${progressLabel})` : ""}`}
                    >
                      <div className="font-bold truncate">{shortName}</div>
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