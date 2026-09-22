/**
 * お客様の予約カレンダーで「その日を選べるか」。
 *
 * ## なぜ1か所に集めたか（2026-09-22）
 *
 * この判定はもともと `CustomerBooking` の `<Calendar disabled={...}>` に直書きされていて、
 * **6つの別々の規則**（過去日・定休日・受付終了・満枠・担当のシフト・予約できる範囲）が
 * 並んでいた。足すたびにあのファイルが膨らみ、**規則としてのテストが書けない**
 * （画面を描かないと確かめられない）状態だった。
 *
 * ここに出したことで、
 *
 *   - 「なぜこの日が押せないのか」の答えが1ファイルに収まる
 *   - 規則そのものを素のテストで確かめられる（`src/test/bookingCalendarDay.test.ts`）
 *   - 新しい規則を足しても `CustomerBooking` は1行も増えない
 *
 * ## 🔴 順番に意味がある
 *
 * 上から順に見る。**先に当たったものが理由**になる。文言の出し分け
 * （「受付終了」「満枠」「次回分のお支払い」…）は別の場所が決めるが、
 * そちらとこちらで順番が食い違うと「押せない理由」と「出る文言」がズレる。
 *
 * ## 🔴 当日は塞がない
 *
 * 締切の判定は**枠ごと**に `isSlotPastCutoff` が行う。
 * prev_day の店なら全枠が不可＝従来どおり「閲覧のみ」、hours_before の店なら
 * 締切前の枠だけ取れる。ここで当日ごと塞ぐと、2026-09-05 に入れた
 * 「上限で埋まった当日の空き状況を、その日に予約している人にだけ見せる」が消える。
 */
import { isClosedDate, weekdayOfDateKey, type OperatingHours } from "@/lib/businessHours";
import { isDayHardClosed, type ClosedDay } from "@/lib/bookingClosedDays";
import { isBeyondBookingWindow, LEGACY_MEMBER_WINDOW_MONTHS } from "@/lib/bookingWindow";
import { staffWorksOnWeekday, type StaffScheduleRow } from "@/lib/staffSchedule";
import { isBlockedByNextCyclePayment } from "@/lib/nextCyclePayment";

export interface CalendarDayRules {
  /** JST の今日（yyyy-MM-dd）。これより前は過去日。 */
  today: string;
  businessHours: OperatingHours | null | undefined;
  closedDays: ReadonlyArray<ClosedDay>;
  /** その日に自分の予約があるか。上限で埋まった当日を開ける判定に使う。 */
  hasOwnBookingOn: (dateKey: string) => boolean;
  /**
   * その日は1枠も取れないか（満枠・受付しない時間帯）。
   * 🔴 状態を持たず毎回数え直す関数を渡すこと（`src/lib/bookingDayFull.ts`）。
   */
  isDayFull: (dateKey: string) => boolean;
  staffSchedules: ReadonlyArray<StaffScheduleRow> | null | undefined;
  /** 指名した担当。null＝指名なし。 */
  staffUserId: string | null;
  /** 何日先まで受け付けるか。null＝未設定（従来どおり1ヶ月先まで）。 */
  bookingWindowDays: number | null;
  /**
   * 「この日以降は次回分の入金が要る」日付（`get_my_next_cycle_payment_gate`）。
   * null＝止めるものが無い。読めなかったときも null にすること（安全側）。
   */
  nextCyclePaymentGate: string | null;
}

/** カレンダーでその日を選べないか。`<Calendar disabled>` にそのまま渡す答え。 */
export const isDayUnselectable = (dateKey: string, r: CalendarDayRules): boolean => {
  // 過去日。当日は塞がない（上の 🔴 参照）
  if (!!dateKey && dateKey < r.today) return true;
  // 定休日。toDate があっても、その間の定休日は個別に塞ぐ必要がある
  if (isClosedDate(r.businessHours, dateKey)) return true;
  // 店が「その日はもう受けない」とした日、または1日の上限に達した日。
  // 定休日と同じ見た目（選べない）にする。最終判定は DB（GB007）。
  // ⚠️ 上限で埋まった**当日**を、**その日に自分の予約がある人**にだけ開ける
  //    （押しても予約はできない。空き時間を見せるだけ）。
  //    手で止めた日と、先の日付の上限は今までどおり塞ぐ。
  if (isDayHardClosed(r.closedDays, dateKey, r.hasOwnBookingOn(dateKey))) return true;
  // 全枠が満枠／受付しない時間帯の日。定休日と同じ見た目にする
  if (r.isDayFull(dateKey)) return true;
  // 次回分の入金がまだの日（店が設定している場合のみ）。最終判定は DB（GB009）
  if (isBlockedByNextCyclePayment(r.nextCyclePaymentGate, dateKey)) return true;
  // 指名した担当が出勤していない曜日。指名なしなら常に false
  if (!staffWorksOnWeekday(r.businessHours, weekdayOfDateKey(dateKey), r.staffSchedules, r.staffUserId)) {
    return true;
  }
  return isBeyondBookingWindow(dateKey, r.bookingWindowDays, { months: LEGACY_MEMBER_WINDOW_MONTHS });
};
