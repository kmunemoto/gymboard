import { supabase } from "@/integrations/supabase/client";
import { readOptionMinutes } from "@/lib/bookingOptions";

// useBookings.ts（行数の上限）から移した。予約変更の巻き戻しで使う。
/**
 * 予約行に紐づく Googleカレンダー予定を作り直す（存在しなければ新規作成）。
 * 消化(forfeit)キャンセルは Googleカレンダー予定を削除して google_event_id を null に
 * するため、消化を「予約済み」に戻すだけではカレンダー予定が復活しない。リスケ失敗の
 * ロールバック時にこれを呼び、トレーナーの外部カレンダーに予定を復元する。best-effort。
 */
export async function resyncCalendarCreate(bookingId: string): Promise<void> {
  const { data: b } = await supabase
    .from("bookings")
    .select("id, user_id, booking_date, booking_type, option_minutes")
    .eq("id", bookingId)
    .maybeSingle();
  if (!b) return;
  const { data: prof } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", b.user_id)
    .maybeSingle();
  await supabase.functions.invoke("google-calendar-sync", {
    body: {
      action: "create",
      booking_id: b.id,
      booking_date: b.booking_date,
      booking_type: b.booking_type,
      client_name: prof?.display_name || "顧客",
      option_minutes: readOptionMinutes((b as { option_minutes?: number | null }).option_minutes),
    },
  });
}
