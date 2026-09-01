import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useBookingClosedDays, useCloseDay } from "@/hooks/useBookingClosedDays";
import { closedDayReason, countsTowardDailyLimit, type ClosedDay } from "@/lib/bookingClosedDays";

interface BookingLike {
  date: string;
  status: string;
  isBlocked?: boolean;
}

/**
 * 予定表から「その日の受付を止める／解除する」ための一式。
 *
 * TrainerSchedule.tsx は既に大きいので、読み込み・保存・トースト・人数の数え方を
 * ここにまとめて、あちらは表示だけにする（src/test/qualityRatchet.test.ts）。
 */
export function useDayReception(
  fromKey: string,
  toKey: string,
  bookings: readonly BookingLike[],
  dailyLimit: number | null,
) {
  const { t } = useTranslation();
  const { closedDays, refetch } = useBookingClosedDays(fromKey, toKey);
  const { close, reopen, saving } = useCloseDay();

  /**
   * 🔴 数え方は DB（`tenant_day_booking_count`）とそろえること。
   *
   * 予定表の一覧（getDayBookings）は「同日キャンセル済み」を**表示から**外しているが、
   * DB は数える。そちらを使い回すと、予定表の人数だけ1人少なく見えて
   * 「あと1人取れるはずなのに受付終了」になる。
   * ブロック枠は予約ではないので数えない（DB も blocked_slots は数えていない）。
   */
  const bookedCountOn = useCallback(
    (dateKey: string): number =>
      bookings.filter((b) => b.date === dateKey && !b.isBlocked && countsTowardDailyLimit(b.status))
        .length,
    [bookings],
  );

  const closedOn = useCallback(
    (dateKey: string): ClosedDay | null => closedDayReason(closedDays, dateKey),
    [closedDays],
  );

  const closeDay = useCallback(
    async (dateKey: string) => {
      const { error } = await close(dateKey);
      if (error) {
        toast.error(t("closedDays.closeFailed"));
        return;
      }
      await refetch();
      toast.success(t("closedDays.closedToast", { date: dateKey }));
    },
    [close, refetch, t],
  );

  const reopenDay = useCallback(
    async (dateKey: string) => {
      const { error } = await reopen(dateKey);
      if (error) {
        toast.error(t("closedDays.reopenFailed"));
        return;
      }
      await refetch();
      toast.success(t("closedDays.reopenedToast", { date: dateKey }));
    },
    [reopen, refetch, t],
  );

  return { closedOn, bookedCountOn, closeDay, reopenDay, saving, dailyLimit };
}
