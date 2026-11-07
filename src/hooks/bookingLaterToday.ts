import { supabase } from "@/integrations/supabase/client";
import { resyncCalendarCreate } from "@/lib/calendarResync";
import { sendRescheduleToTrainer } from "@/hooks/useBookings";

/**
 * 当日の予約を、同じ日の後ろの時間へ動かす（2026-11-07・ジムの設定 same_day_later_reschedule_enabled。消化しない）。
 * 決まりは `src/lib/sameDayReschedule.ts`。
 *
 * 予約そのものは DB の `move_booking_later_today` が「消す → 作る」を1回で動かす
 * （当日の予約の削除は DB が止めているので、アプリの `rescheduleBooking` の2手では動かせない。
 *  途中で断られたら、元の予約はそのまま残る）。ここで足すのは、その前後のアプリ側の仕事だけ:
 *
 *   1. 元の予約の Googleカレンダーの予定を消す。🔴 **予約の行が残っているうちに**消す
 *      （google-calendar-sync は予約の行から予定の ID を読む。消したあとでは見つけられない。cancelBooking と同じ順番）
 *   2. 動かす。断られたら、1. で消した予定だけ戻して終わる（予約は元のまま）
 *   3. 新しい予約の予定を Googleカレンダーへ作る（createBooking と同じ）
 *   4. 店へ「予約日時の変更」を送る（今までの日時の変更と同じ通知。消化ではないので forfeit=false）
 *
 * 返り値の形は `rescheduleBooking` と同じ（呼び出し側の分岐を1つで済ませるため）。
 * restoreFailed は起きない（DB が1回で動かすので、予約が消えたままになることがない）。
 */
export const moveBookingLaterToday = async (
  bookingId: string,
  newDate: string,
  newStartTime: string,
): Promise<{ data: { id: string } | null; error: unknown; restoreFailed?: boolean }> => {
  const { data: old, error: fetchError } = await supabase
    .from("bookings")
    .select("*") // 列を明示しない（rescheduleBooking と同じ理由。未適用の列で 42703 にしない）
    .eq("id", bookingId)
    .maybeSingle();
  if (fetchError || !old) return { data: null, error: fetchError ?? new Error("booking not found") };

  // 1. 元の予定を消す（best-effort。失敗しても予約の変更は止めない）
  const hadEvent = !!old.google_event_id;
  if (hadEvent) {
    await supabase.functions
      .invoke("google-calendar-sync", {
        body: { action: "delete", booking_id: old.id, google_event_id: old.google_event_id },
      })
      .catch((e) => console.error("later-today: Google Calendar event delete failed:", e));
  }

  // 2. 動かす
  const { data: newId, error } = await supabase.rpc("move_booking_later_today", {
    p_booking_id: bookingId,
    p_new_booking_date: `${newDate}T${newStartTime}:00+09:00`,
  });
  if (error || !newId) {
    // 予約は元のまま。消した予定だけ戻す
    if (hadEvent) {
      await resyncCalendarCreate(bookingId).catch((e) =>
        console.error("later-today: calendar restore failed:", e),
      );
    }
    return { data: null, error: error ?? new Error("move_booking_later_today returned no id") };
  }

  // 3. 新しい予約の予定を作る（best-effort）
  void resyncCalendarCreate(newId).catch((e) => console.error("later-today: calendar create failed:", e));

  // 4. 店へ「予約日時の変更」
  sendRescheduleToTrainer(
    old.user_id, old.booking_date, newDate, newStartTime, old.booking_type, false, old.staff_user_id ?? null,
  ).catch((e) => console.error("later-today: sendRescheduleToTrainer failed:", e));

  return { data: { id: newId }, error: null };
};
