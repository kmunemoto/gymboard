import { supabase } from "@/integrations/supabase/client";
import {
  readOptionMinutes,
  type BookingOptionSnapshot,
} from "@/lib/bookingOptions";

/**
 * 既に入っている予約のオプションを差し替える（**店側専用**）。
 *
 * 実店舗の要望（2026-09-03 宗本さん）:「あとからオプション追加したいっていう人も
 * いるかもなので追加して。でもそれはお店側で追加する。後ろがもう埋まってたら無理だしね」。
 *
 * 🔴 **後ろが空いているかの判定は DB が正**（`guard_booking_option_change`、SQLSTATE `GB008`）。
 * 重複判定 `check_booking_overlap` は BEFORE INSERT にしか刺さっていないので、
 * この UPDATE 専用のトリガーが唯一の関門になる。ここを画面側の判定で代用しないこと。
 *
 * 🔴 お客様側からは呼ばない。伸ばせるかどうかは「後ろの予約」に依存し、それは
 * お客様には見えない（誰の予約かは他のお客様には出さない）。断られる理由を説明できない
 * 操作をお客様に出すと、原因の分からない失敗になる。
 *
 * カレンダーは**消してから作り直す**。`google-calendar-sync` に「長さだけ変える」経路が
 * 無いため（create / delete / sync_all の3つしかない）。失敗しても予約の変更自体は成立させる
 * ——外部カレンダーのために店の操作を巻き戻すほうが害が大きい。
 */
export async function updateBookingOptions(
  bookingId: string,
  optionMinutes: number,
  bookingOptions: BookingOptionSnapshot[],
): Promise<{ error: unknown }> {
  const minutes = readOptionMinutes(optionMinutes);
  const { error } = await supabase
    .from("bookings")
    .update({
      option_minutes: minutes,
      // 空配列ではなく null を入れる（「付いていない」を1つの表現にそろえる）
      booking_options: bookingOptions.length > 0 ? bookingOptions : null,
    } as never)
    .eq("id", bookingId);
  if (error) return { error };

  // 長さが変わったので、トレーナーの Googleカレンダーを作り直す（best-effort）
  try {
    const { data: b } = await supabase
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, google_event_id, option_minutes")
      .eq("id", bookingId)
      .maybeSingle();
    if (b) {
      if (b.google_event_id) {
        await supabase.functions.invoke("google-calendar-sync", {
          body: { action: "delete", booking_id: b.id, google_event_id: b.google_event_id },
        });
      }
      const { data: prof } = await supabase
        .from("profiles").select("display_name").eq("user_id", b.user_id).maybeSingle();
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
  } catch (e) {
    console.error("オプション変更後のカレンダー同期に失敗:", e);
  }

  return { error: null };
}
