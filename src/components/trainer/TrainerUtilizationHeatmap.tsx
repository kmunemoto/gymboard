import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAllBookings, SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";
import { useTenant } from "@/hooks/useTenant";
import { getJSTNow, toJSTDate } from "@/lib/timezone";
import { format, subDays } from "date-fns";
import { formatWeekdayShort } from "@/lib/dateFormat";
import { isClosedWeekday, timelineHourRange } from "@/lib/businessHours";

// 稼働率ヒートマップ: 曜日×時間帯で、過去28日間のうちその枠に予約が入っていた日の割合を出す。
// 厳密な「枠の埋まり率」（slot_duration_minutes/booking_buffer_minutes を厳密に反映した
// 占有計算）ではなく、「その時間帯に予約が付いた日がどれくらいあったか」という近似値。
// ジムごとに営業時間内の1時間ごとのバケットで見るだけなら十分な精度で、実装・表示の
// シンプルさを優先した（正確な占有計算は check_booking_overlap 側にあり、ここでは使わない）。
const LOOKBACK_DAYS = 28;
// 月曜始まりで表示（日本のビジネス慣習に合わせる）。JS の Date.getDay() は日曜=0。
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const cellClass = (rate: number | null): string => {
  if (rate === null) return "bg-transparent";
  if (rate === 0) return "bg-muted/40";
  if (rate <= 25) return "bg-accent/25";
  if (rate <= 50) return "bg-accent/45";
  if (rate <= 75) return "bg-accent/65";
  return "bg-accent text-accent-foreground";
};

const TrainerUtilizationHeatmap = () => {
  const { t } = useTranslation();
  const { bookings, loading } = useAllBookings();
  const { tenant } = useTenant();

  // 営業時間の解釈は businessHours.ts に一本化してある。
  // ここは曜日×時間の1枚の表なので、**曜日別の営業時間があっても包絡線**で軸を作る
  // （曜日ごとに行数が変わると表として読めない）。定休日の列は下で空欄にする。
  const { startHour, endHour } = timelineHourRange(tenant?.operating_hours);
  const hours = useMemo(
    () => Array.from({ length: Math.max(0, endHour - startHour) }, (_, i) => startHour + i),
    [startHour, endHour],
  );

  const { grid, totalByWeekday, hasData } = useMemo(() => {
    const now = getJSTNow();
    const todayStr = format(now, "yyyy-MM-dd");
    const fromStr = format(subDays(now, LOOKBACK_DAYS), "yyyy-MM-dd");

    // 過去 LOOKBACK_DAYS 日間、曜日ごとに何回出現したか（分母）
    const totals: Record<number, number> = {};
    for (let i = 1; i <= LOOKBACK_DAYS; i++) {
      const d = subDays(now, i);
      const dow = d.getDay();
      totals[dow] = (totals[dow] || 0) + 1;
    }

    // occupied[dow][hour] = 予約が入っていた日付の Set（同日複数予約の重複カウントを防ぐ）
    const occupied: Record<number, Record<number, Set<string>>> = {};
    let any = false;
    bookings.forEach((b) => {
      if (b.date >= todayStr || b.date < fromStr) return; // 未来日・範囲外は除外
      if (b.status === "キャンセル済み" || b.status === SAME_DAY_FORFEIT_STATUS || b.user_id === "blocked") return;
      const [h] = b.startTime.split(":").map(Number);
      if (!Number.isFinite(h) || h < startHour || h >= endHour) return;
      // b.date は "yyyy-MM-dd"（JST暦日）の文字列。素の new Date(...).getDay() は
      // 閲覧デバイスのタイムゾーンに依存して曜日がズレる（timezone.ts の注意書き参照）ため、
      // 必ず toJSTDate 経由で「JST基準の曜日」を取る。
      const dow = toJSTDate(b.date).getDay();
      if (!occupied[dow]) occupied[dow] = {};
      if (!occupied[dow][h]) occupied[dow][h] = new Set();
      occupied[dow][h].add(b.date);
      any = true;
    });

    const g: Record<number, Record<number, number | null>> = {};
    WEEKDAY_ORDER.forEach((dow) => {
      g[dow] = {};
      hours.forEach((h) => {
        const total = totals[dow] || 0;
        if (total === 0) { g[dow][h] = null; return; }
        const occ = occupied[dow]?.[h]?.size ?? 0;
        g[dow][h] = Math.round((occ / total) * 100);
      });
    });

    return { grid: g, totalByWeekday: totals, hasData: any };
  }, [bookings, hours, startHour, endHour]);

  if (loading || hours.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <Flame className="w-3.5 h-3.5" />
        {t("dashboard.utilizationSection")}
      </h2>
      <Card>
        <CardContent className="p-3 sm:p-4">
          {!hasData ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("dashboard.utilizationEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-separate" style={{ borderSpacing: "3px" }}>
                <thead>
                  <tr>
                    <th className="w-8" />
                    {hours.map((h) => (
                      <th key={h} className="text-[9px] font-normal text-muted-foreground px-0.5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAY_ORDER.map((dow) => (
                    <tr key={dow}>
                      <td className="text-[10px] font-bold text-muted-foreground pr-1 text-right">
                        {formatWeekdayShort(dow)}
                      </td>
                      {hours.map((h) => {
                        // 定休日はそもそも予約が取れないので、0% と書くと
                        // 「暇な曜日」に見えてしまう。空欄にして区別する。
                        const rate = isClosedWeekday(tenant?.operating_hours, dow)
                          ? null
                          : grid[dow]?.[h] ?? null;
                        return (
                          <td key={h}>
                            <div
                              className={`w-6 h-6 sm:w-7 sm:h-7 rounded flex items-center justify-center text-[8px] font-bold ${cellClass(rate)}`}
                              title={rate !== null ? `${formatWeekdayShort(dow)} ${h}:00 — ${rate}%` : undefined}
                            >
                              {rate !== null && rate > 0 ? rate : ""}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-muted-foreground mt-3">{t("dashboard.utilizationHint")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};

export default TrainerUtilizationHeatmap;
