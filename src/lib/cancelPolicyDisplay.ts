/**
 * キャンセルについての案内（tenants.cancel_policy_body）を、お客様の画面のどこに出すか（2026-11-07 宗本さん）。
 *
 * > 予約するページの上のキャンセルについてを出さなくていい。当日キャンセルされる場合にだけ出して。
 * > 前日より前のキャンセル、つまり通常のキャンセルも出さなくていい。
 * > 当日のキャンセルと明日以降への日時変更の際だけ表示されるようにして
 *
 * tenants.cancel_policy_same_day_only（`=== true` で渡す。列が読めない環境では今まで通り）:
 *
 *   - 予約画面の上（"bookingTop"） ………………………………………… OFF（既定・今まで通り）: 出す ／ ON: 出さない
 *   - キャンセルの確認（"cancelConfirm"）・前日までの予約 …… OFF: 出す ／ ON: 出さない
 *   - キャンセルの確認（"cancelConfirm"）・当日の予約 ………… OFF: 出す ／ ON: 出す
 *   - 当日の予約を明日以降へ変える確認（"rescheduleForfeit"） … OFF: 出さない ／ ON: 出す
 *
 * "rescheduleForfeit" は、当日キャンセルの消化が ON のジムで、当日の予約を明日以降へ動かすときの
 * 「1回分の消化になります」の確認（src/lib/sameDayReschedule.ts の "forfeit"）。同じ日の後ろへの変更
 * （"laterToday"・消化しない）や、前日までの予約の変更では出ない（その確認自体が無い）。
 *
 * 案内が空欄なら、どこにも出さない（呼ぶ側の `cancelPolicy &&` が受け持つ。既定文は持たない）。
 * 当日キャンセルの消化の警告（キャンセルの2回目の確認）を出している間は、そちらが優先（今まで通り）。
 *
 * 日付はどれも JST の yyyy-MM-dd。
 */
export type CancelPolicyPlace = "bookingTop" | "cancelConfirm" | "rescheduleForfeit";

export const showCancelPolicyAt = (
  place: CancelPolicyPlace,
  args: {
    /** tenants.cancel_policy_same_day_only（`=== true` で渡す） */
    sameDayOnly: boolean;
    /** キャンセル・変更する予約の日付。予約画面の上では渡さない */
    targetDate?: string | null;
    /** 今日（JST） */
    today: string;
  },
): boolean => {
  if (!args.sameDayOnly) return place !== "rescheduleForfeit";
  if (place === "bookingTop") return false;
  // 当日の予約だけ（前日までの予約のキャンセル＝ふだんのキャンセルには出さない）
  return !!args.targetDate && args.targetDate === args.today;
};
