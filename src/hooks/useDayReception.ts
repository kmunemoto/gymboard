import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useBookingClosedDays, useCloseDay } from "@/hooks/useBookingClosedDays";
import { closedDayReason, countsTowardDailyLimit, type ClosedDay } from "@/lib/bookingClosedDays";

interface BookingLike {
  date: string;
  status: string;
  user_id: string;
  isBlocked?: boolean;
}

/**
 * 予定表の行のうち、体験・ドロップインのもの。
 * useBookings が trial_bookings 由来の行に必ずこの user_id を入れる。
 */
const TRIAL_GUEST = "trial-guest";

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
   * 🔴 数え方は DB（`tenant_day_booking_count`）とそろえること。ずれると、
   *    予定表の人数と実際の受付終了の判定が食い違う。
   *
   * 除くもの:
   *   体験・ドロップイン … 🔴 **仕組みから完全に外す**（2026-09-01 宗本さんの指示）。
   *                        「体験予約は上限なく受け付けます」。止めないだけでなく、
   *                        1日の人数にも数えない。DB 側も bookings しか数えていない。
   *   ブロック枠         … 予約ではない（休憩を入れただけで受付が止まるのはおかしい）
   *   キャンセル済み     … `countsTowardDailyLimit` が弾く
   *
   * ⚠️ 予定表の一覧（getDayBookings）は「同日キャンセル済み」を**表示から**外しているが、
   *    DB は数える。そちらを使い回すと、人数だけ1人少なく見える。
   */
  const bookedCountOn = useCallback(
    (dateKey: string): number =>
      bookings.filter(
        (b) =>
          b.date === dateKey &&
          !b.isBlocked &&
          b.user_id !== TRIAL_GUEST &&
          countsTowardDailyLimit(b.status),
      ).length,
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
