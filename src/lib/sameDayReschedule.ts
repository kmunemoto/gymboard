/**
 * 当日の予約を動かすときの扱い（2026-11-07 宗本さんの決定）。
 *
 * > 当日キャンセルとか当日日時変更した人って、その次の週に振り替えはるじゃないですか。
 * > だったらその次の週の予約がもう埋まっちゃうんですよ。
 * > だからやっぱり当日キャンセルと当日の明日以降への日時変更は1回消費扱いにしましょう。
 * > 当日の中での時間の変更は1回消費扱いはなしにします。
 *
 * 当日キャンセルの消化（tenants.same_day_cancel_penalty_enabled）が ON のジムで:
 *   - 当日キャンセル …………………… 1回消化（ここではなく、キャンセルの画面が扱う）
 *   - 当日の予約を明日以降へ動かす … 1回消化（"forfeit"）
 *   - 同じ日の別の時間へ動かす ……… 消化しない。ただし**アプリからはできない**（"contactGym"）
 *       DB（enforce_booking_same_day_delete）が、当日の予約をお客様が消化なしで手放すことを止めている。
 *       アプリの「変更」は「消す → 作り直す」なので、ここを通すと抜け道（消化なしの当日キャンセル）になる。
 *       お客様にはチャットか LINE で頼んでもらい、店が予定表で「消化扱いにする」を外して取り消し、
 *       新しい時間で入れ直す（店は DB の見張りの対象外）。
 *   - ON でない・当日の予約でない … いつもどおり（"normal"）
 *
 * 締切が「前日まで」のジム（Salute御所南）では、お客様はそもそも当日の枠を選べないので、
 * "contactGym" になるのは締切が「何時間前まで」のジムだけ。
 *
 * 日付はどれも JST の yyyy-MM-dd。
 */
export type SameDayRescheduleRule = "normal" | "forfeit" | "contactGym";

export const sameDayRescheduleRule = (args: {
  penaltyEnabled: boolean;
  /** 動かす前の予約の日付 */
  targetDate: string;
  /** 動かす先の日付 */
  newDate: string;
  /** 今日（JST） */
  today: string;
}): SameDayRescheduleRule => {
  if (!args.penaltyEnabled || args.targetDate !== args.today) return "normal";
  return args.newDate === args.targetDate ? "contactGym" : "forfeit";
};
