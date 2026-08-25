import { ja } from "date-fns/locale";
import { formatJST } from "@/lib/timezone";
import { SAME_DAY_FORFEIT_STATUS } from "@/lib/bookingStatus";

/**
 * 予約をチャットに引用する。
 *
 * ## なぜ要るか
 * 「明日の予約の件ですが…」を、**文脈のないテキストで**打っている状態だった。
 * どの予約の話か会話からは分からず、あとから読み返しても業務記録にならない。
 * 直近の予約をチップで出し、押したら本文の先頭に日時と種別を差し込む。
 *
 * ## DB は増やしていない
 * 引用は**ただの文字列**として本文に入る。参照を持たせると、予約を消したときに
 * 会話が壊れる（「削除された予約」という吹き出しが残る）。
 * 文字列なら、あとで予約を消しても会話はそのまま読める。
 */

export interface QuotableBooking {
  id: string;
  booking_date: string;
  booking_type: string | null;
  status: string;
}

/** 予定として扱わない状態。キャンセル系は引用の候補にしない。 */
const DEAD_STATUSES = new Set(["キャンセル済み", SAME_DAY_FORFEIT_STATUS]);

export const isQuotableStatus = (status: string): boolean => !DEAD_STATUSES.has(status);

/** チップに出す最大件数。増やすと入力欄の上が埋まる。 */
export const MAX_QUOTE_CHIPS = 3;

/**
 * 引用の候補を選ぶ。**これから来る予約を優先**し、足りなければ直近の過去で埋める。
 *
 * 会話のきっかけは「次いつ来るか」と「この前どうだったか」の2つ。
 * 未来を先に出すのは、予約の確認・変更のほうが件数として多いため。
 */
export function pickQuotableBookings(
  bookings: QuotableBooking[],
  now: Date = new Date(),
): QuotableBooking[] {
  const alive = bookings.filter((b) => isQuotableStatus(b.status));
  const t = now.getTime();

  const upcoming = alive
    .filter((b) => new Date(b.booking_date).getTime() >= t)
    .sort((a, b) => new Date(a.booking_date).getTime() - new Date(b.booking_date).getTime());

  const past = alive
    .filter((b) => new Date(b.booking_date).getTime() < t)
    .sort((a, b) => new Date(b.booking_date).getTime() - new Date(a.booking_date).getTime());

  return [...upcoming, ...past].slice(0, MAX_QUOTE_CHIPS);
}

/** チップに出す短い見出し。「8/13(水) 19:00」 */
export function formatQuoteChipLabel(booking: QuotableBooking): string {
  // 曜日は既存画面と同じ作法で日本語にする（CustomerHome 等が { locale: ja } を渡している）
  return formatJST(booking.booking_date, "M/d(E) HH:mm", { locale: ja });
}

/**
 * 本文に差し込む文字列。「【8/13(水) 19:00 パーソナル60分】」
 * 種別が無ければ日時だけ。
 */
export function formatBookingQuote(booking: QuotableBooking): string {
  const when = formatJST(booking.booking_date, "M/d(E) HH:mm", { locale: ja });
  const type = booking.booking_type?.trim();
  return type ? `【${when} ${type}】` : `【${when}】`;
}

/**
 * 引用を本文に入れる。
 *
 * ⚠️ 引用は**先頭**に置く（「何について」を先に言う）。書きかけがあれば改行で続ける。
 *    同じ引用を二重に入れない（連打しても増えない）。
 */
export function prependQuote(current: string, quote: string): string {
  if (current.includes(quote)) return current;
  const rest = current.replace(/^\s+/, "");
  return rest ? `${quote}\n${rest}` : `${quote}\n`;
}
