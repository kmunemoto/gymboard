import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useBookingClosedDays, useCloseDay, useUncapDay, useUncappedDays } from "@/hooks/useBookingClosedDays";
import { closedDayReason, countsTowardDailyLimit, type ClosedDay } from "@/lib/bookingClosedDays";
import { memberLimitOn } from "@/lib/weeklyPeak";

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
  /** 週に何日かだけ上限を増やす設定（tenants.weekly_peak_limit / weekly_peak_days。2026-10-22） */
  weeklyPeak: { limit: number | null; days: number | null } = { limit: null, days: null },
  /** 体験も含めた1日の合計の上限（tenants.daily_total_limit）。予定表の「n/◯人」に使う */
  dailyTotalLimit: number | null = null,
) {
  const { t } = useTranslation();
  const { closedDays, refetch } = useBookingClosedDays(fromKey, toKey);
  const { close, reopen, saving } = useCloseDay();
  // その日だけ1日の上限を適用しない日（2026-09-20）。ジム側だけが読む。
  const { uncappedDays, refetch: refetchUncapped } = useUncappedDays(fromKey, toKey);
  const { uncap, recap, saving: uncapSaving } = useUncapDay();

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
   * 🔴 営業時間外に店が入れた予約は**数える**（2026-10-23 宗本さん「全ての予約を合わせて1日5枠まで」）。
   *    2026-10-17〜10-22 は除いていたが、そのせいで5件入った日に6件目の体験が通った。
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

  /** その日は「上限なし」に指定されているか */
  const uncappedOn = useCallback(
    (dateKey: string): boolean => uncappedDays.includes(dateKey),
    [uncappedDays],
  );

  const peakLimit = weeklyPeak.limit;
  const peakDays = weeklyPeak.days;
  /**
   * その日の会員の上限（予定表の「n/◯人」）。週の「多い日」を反映する（src/lib/weeklyPeak.ts）。
   * 🔴 判定の正は DB の `tenant_member_day_limits`。表示だけここで同じ計算をする。
   */
  const dailyLimitOn = useCallback(
    (dateKey: string): number | null =>
      memberLimitOn(dateKey, { dailyLimit, peakLimit, peakDays }, bookedCountOn, uncappedOn),
    [dailyLimit, peakLimit, peakDays, bookedCountOn, uncappedOn],
  );

  /** その日の体験・ドロップインの件数。DB の `tenant_day_trial_count` と同じ（キャンセル済み以外） */
  const trialCountOn = useCallback(
    (dateKey: string): number =>
      bookings.filter(
        (b) => b.date === dateKey && !b.isBlocked && b.user_id === TRIAL_GUEST && countsTowardDailyLimit(b.status),
      ).length,
    [bookings],
  );

  /**
   * 予定表の札に出す「n/◯人」（2026-10-26）。
   *
   * 合計の上限（体験込み）が会員の上限以下なら、合計のほうが先に効くので、**体験も足して**
   * 合計の上限と並べる。宗本さん「全ての予約を含めて一日5枠まで（体験も含める）」。
   *   会員5・合計5 → 会員3＋体験1 は「4/5人」
   *   会員4・合計5 → 今まで通り会員だけ「3/4人」（5枠目は体験のために空けてある設定）
   * 上限を外した日は合計の上限も外れる（DB の tenant_day_total_reached と同じ）。
   */
  const chipCountOn = useCallback(
    (dateKey: string): { bookedCount: number; dailyLimit: number | null } => {
      const members = bookedCountOn(dateKey);
      const memberLimit = dailyLimitOn(dateKey);
      if (dailyTotalLimit != null && !uncappedOn(dateKey) && (memberLimit == null || dailyTotalLimit <= memberLimit)) {
        return { bookedCount: members + trialCountOn(dateKey), dailyLimit: dailyTotalLimit };
      }
      return { bookedCount: members, dailyLimit: memberLimit };
    },
    [bookedCountOn, dailyLimitOn, uncappedOn, trialCountOn, dailyTotalLimit],
  );

  /**
   * その日だけ上限を外す。
   *
   * 🔴 閉店日の一覧（closedDays）も取り直すこと。外した瞬間に「上限で閉まっている」が
   *    消えるので、取り直さないとオレンジのままに見える。
   */
  const liftCap = useCallback(
    async (dateKey: string) => {
      const { error } = await uncap(dateKey);
      if (error) {
        toast.error(t("closedDays.uncapFailed"));
        return;
      }
      await Promise.all([refetchUncapped(), refetch()]);
      toast.success(t("closedDays.uncappedToast", { date: dateKey }));
    },
    [uncap, refetchUncapped, refetch, t],
  );

  /** 上限を元に戻す。件数が上限に達していれば、その場でまた閉まる。 */
  const restoreCap = useCallback(
    async (dateKey: string) => {
      const { error } = await recap(dateKey);
      if (error) {
        toast.error(t("closedDays.recapFailed"));
        return;
      }
      await Promise.all([refetchUncapped(), refetch()]);
      toast.success(t("closedDays.recappedToast", { date: dateKey }));
    },
    [recap, refetchUncapped, refetch, t],
  );

  return {
    closedOn, bookedCountOn, closeDay, reopenDay, dailyLimit, dailyLimitOn, chipCountOn,
    saving: saving || uncapSaving,
    uncappedOn, liftCap, restoreCap,
  };
}
