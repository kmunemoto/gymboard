/**
 * 予約が DB に断られたとき、お客様に何と言うか。
 *
 * ## 🔴 「アプリが古い」を言い当てる（2026-09-03）
 *
 * 実店舗で起きたこと。お客様から店のチャットにこう届いた:
 *
 * > 9/13 13:45 から予約しようとしてるんですが、「予約に失敗しました」と表示され
 * > 予約できず… ちなみに他の日時は予約できたので、この部分だけの不具合かもしれません。
 *
 * 不具合ではなく、**そのお客様のアプリが古かった**。9/1 に入れた「1日の上限人数」
 * （`GB007`）を古いアプリは知らないので、上限に達した日の枠を**「空き」として見せ**、
 * 送信して初めて DB に断られる。しかも案内が「予約に失敗しました」だけなので、
 * お客様には打つ手が分からない。**気づいて連絡をくれた人だけが救われ、
 * 残りは黙って諦める。**
 *
 * 予約のガードは**すべて `GB0xx`** を持つ。既知のどれでもない `GB0xx` が返ってきたら、
 * **サーバーにこのアプリが知らない規則が入っている**＝アプリが古い。
 * これは推測ではなく、コードそのものが証拠になる。
 *
 * ⚠️ **この案内は「これから配る版」にしか入らない。** すでに古い版を使っている人には
 * 届かない（その人の端末で動いているのは古いコードなので）。効くのは次に規則を足したとき。
 *
 * 🔴 新しいガードを足したら `KNOWN_GUARD_CODES` にも足すこと。忘れると、正しく動いている
 *    最新版のアプリに「更新してください」と出る。`src/test/bookingErrors.test.ts` が
 *    migrations 側の `ERRCODE` と突き合わせて見張っている。
 *
 * ## 判定を1箇所に集める理由
 *
 * 単発予約とくり返し予約で判定が別々に書かれていて、**くり返し側は3種類しか見ていなかった**
 * （受付終了で全滅しても「予約に失敗しました」としか出ない）。分かれている限り、
 * 片方だけ直す事故が起き続ける。
 */
import { isPlanLimitError } from "@/lib/planSessionLimit";
import { isDayClosedError } from "@/lib/bookingClosedDays";
import { isBlockedWindowError } from "@/lib/bookingBlockedWindows";
import { isBookingLimitError } from "@/lib/bookingLimits";
import { isStaffOffShiftError } from "@/lib/staffSchedule";
import { isStaffConflictError } from "@/lib/tenantStaff";

/**
 * このアプリが意味を知っている SQLSTATE。**DB の migrations にあるものと同じ集合**に保つ。
 *
 * ここに無い `GB0xx` が返ってきたら「アプリのほうが古い」と判断する。
 */
export const KNOWN_GUARD_CODES = [
  "GB001", // 指名した担当がその時間帯に埋まっている
  "GB002", // 指名した担当のシフト外
  "GB003", // 予約回数の制限（曜日×時間帯×期間）
  "GB004", // プランの回数上限
  "GB005", // 契約の内容を本人が書き換えようとした（予約の経路からは到達しない）
  "GB006", // 受付しない時間帯
  "GB007", // その日は受付終了（1日の上限に到達／店が手で停止）
  "GB008", // あとからオプションを足せない（すぐ後ろが空いていない）
] as const;

/** 予約のガードが使う SQLSTATE の形。ここに当てはまるものだけを「規則による拒否」とみなす。 */
const GUARD_CODE_PATTERN = /^GB\d{3}$/;

/**
 * 「サーバーの規則のほうが、このアプリより新しい」＝アプリが古い、を表すエラーか。
 *
 * 通信エラーや満枠（SQLSTATE を持たない `P0001`）には**当てはまらない**。
 * 当てはめてしまうと、直前に枠を取られただけの人にまで「更新してください」と出て、
 * 更新しても直らない案内になる。
 */
export const isAppOutdatedError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || !GUARD_CODE_PATTERN.test(code)) return false;
  return !(KNOWN_GUARD_CODES as readonly string[]).includes(code);
};

/** 何も当てはまらなかったときの文言。 */
export const GENERIC_BOOKING_ERROR_KEY = "booking.errorBookingFailed";

/**
 * 予約が断られた理由に対応する文言のキー。
 *
 * 並び順は意味がある（上から順に見る）。とくに `isDayClosedError` は SQLSTATE だけでなく
 * メッセージ本文も見るので、より限定的な判定より後ろに置かないこと。
 */
export const bookingErrorKey = (error: unknown): string =>
  isPlanLimitError(error) ? "planSessions.errorReached"
    : isDayClosedError(error) ? "closedDays.errorClosed"
      : isBlockedWindowError(error) ? "blockedWindows.errorNotAccepting"
        : isBookingLimitError(error) ? "bookingLimits.errorOverLimit"
          : isStaffOffShiftError(error) ? "staff.errorStaffOffShift"
            : isStaffConflictError(error) ? "staff.errorStaffBusy"
              : isAppOutdatedError(error) ? "booking.errorAppOutdated"
                : GENERIC_BOOKING_ERROR_KEY;

/**
 * まとめて失敗したとき（くり返し予約が全滅したとき）の文言。
 *
 * 🔴 **全部が同じ理由のときだけ**その理由を出す。混ざっていたら汎用に倒す——
 * 「4回とも回数上限」と「1回だけ回数上限で残りは満枠」では、お客様が取るべき手が違う。
 */
export const bookingErrorKeyForAll = (errors: ReadonlyArray<unknown>): string => {
  if (errors.length === 0) return GENERIC_BOOKING_ERROR_KEY;
  const keys = new Set(errors.map(bookingErrorKey));
  const [only] = [...keys];
  return keys.size === 1 && only ? only : GENERIC_BOOKING_ERROR_KEY;
};

/**
 * 店側の代理予約が断られたときの文言。お客様向けとは別に持つ。
 *
 * - 文言が違う（お客様には「別の時間を」、店には「設定で変えられます」と言う）
 * - 🔴 **受付終了（GB007）をここで拾わない。** 1日の上限も手動の受付停止も
 *   代理予約には効かない（「今日はもう受けない」と決めたあとで常連を1人足すのは
 *   店の裁量）。拾うと、起きないことの案内を用意することになる
 * - GB003（予約回数の制限）が代理予約で出るのは、トレーナーが**自分を**お客様として
 *   選んだときだけ（`auth.uid() = user_id` になり自己予約扱いになる）
 */
export const proxyBookingErrorKey = (error: unknown): string =>
  isPlanLimitError(error) ? "planSessions.errorReachedProxy"
    : isBlockedWindowError(error) ? "blockedWindows.errorNotAcceptingProxy"
      : isBookingLimitError(error) ? "bookingLimits.errorOverLimitProxy"
        : isStaffOffShiftError(error) ? "staff.errorStaffOffShift"
          : isStaffConflictError(error) ? "staff.errorStaffBusy"
            : isAppOutdatedError(error) ? "booking.errorAppOutdated"
              : "schedule.errorAddFailed";
