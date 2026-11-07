import { supabase } from "@/integrations/supabase/client";
import { SAME_DAY_FORFEIT_STATUS } from "@/lib/bookingStatus";

/**
 * 消化扱いにした当日キャンセル（status = 同日キャンセル済み）を、あとから「消化なし」に戻す（店側・2026-11-07）。
 *
 * 宗本さん「お店側で当日キャンセルして、一回消費をえらんで当日キャンセルしてしまった予約を、
 *          やっぱり一回消費扱いにしないように後からできる機能欲しい」
 *
 * 消化しないキャンセルは、もともと予約の行を消す（`cancelBooking` の forfeit なし）。だから「消化を取り消す」も
 * 行を消す ＝ キャンセルのときに「消化扱いにする」を外したのと同じ結果になる（回数・枠・一覧の扱いも同じ）。
 *   - 消すのは「今も消化扱い」の行だけ（`.eq("status", 同日キャンセル済み)`）。別の画面で先に取り消された・
 *     状態が変わった、なら 0 行で何もしない（`gone: true`。呼ぶ側は一覧を読み直す）
 *   - お客様への通知は送らない（キャンセルの通知は、消化にしたときに送り済み）。キャンセル待ちの「空きました」も送らない
 *     （取り消すのはふつう後日。当日のうちに取り消すと枠は空くが、店が埋める）
 *   - Googleカレンダーの予定は、消化にしたとき（`cancelBooking`）に消してある
 *   - 記録: DB の `on_booking_delete_log` が `booking_notify_log` に 'removed'（操作した人つき）を残す。
 *     同じ予約の 'forfeited' のあとに 'removed' があれば、消化を取り消したと分かる
 *
 * DB: 店のスタッフ（オーナー・先生）は RLS「Trainers can delete any bookings」と当日削除の見張りの例外で消せる。
 * お客様は消化の行を消せない（`enforce_booking_same_day_delete`「消化扱いの予約は削除できません」）。
 * 画面はオーナーにだけ出す（`ForfeitedBookingRow`・先生は今まで通り、キャンセルのときに選ぶだけ）。
 */
export const undoBookingForfeit = async (bookingId: string): Promise<{ error: unknown; gone?: boolean }> => {
  const { data, error } = await supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId)
    .eq("status", SAME_DAY_FORFEIT_STATUS)
    .select("id");
  if (error) return { error };
  if (!data || data.length === 0) return { error: null, gone: true };
  return { error: null };
};
