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
 * ## 当日の後ろへの変更（tenants.same_day_later_reschedule_enabled・同日 宗本さんの要望）
 *
 * > 当日予約してるお客様が、当日の後ろ限定で、当日に予約取ってる予約よりも、後ろの時間で
 * > 日時変更ができる設定を作ってほしい。
 *
 * この設定が ON のジムでは、当日の予約を**同じ日のもっと後ろの時間**へ、お客様がアプリから動かせる
 * （"laterToday"・消化しない。消化の設定が ON でも OFF でも同じ）。
 *   - 動かせるのは、まだ始まっていない当日の予約だけ。動かす先は、その予約の開始時刻より後ろ
 *   - 予約の締切（前日まで等）はこの変更には効かない（効かせると、締切が「前日まで」のジムでは使えない）。
 *     満枠・担当のシフト・回数上限・1日の上限などは、ふだんの予約と同じに効く
 *   - 前の時間への変更は今まで通り（消化の設定が ON なら店に頼む "contactGym"）
 *   - DB の `move_booking_later_today` が「消す → 作る」を1回で行う（途中で断られたら元の予約のまま）。
 *     当日削除の見張りはその関数が消すときだけ通す（supabase/migrations/20261107010000_same_day_later_reschedule.sql）
 *
 * 締切が「前日まで」のジム（Salute御所南）では、お客様はそもそも当日の枠を選べないので、
 * 当日の後ろへの変更が無い（設定が OFF の）とき "contactGym" になるのは締切が「何時間前まで」のジムだけ。
 *
 * 日付はどれも JST の yyyy-MM-dd、時刻は JST の HH:mm（0埋め。文字列のまま大小を比べられる）。
 */
export type SameDayRescheduleRule = "normal" | "forfeit" | "contactGym" | "laterToday";

/**
 * 当日の予約を同じ日の後ろへ動かせるなら、その下限（元の予約の開始時刻 HH:mm）。動かせないなら null。
 * 下限ちょうどは含まない（後ろだけ）。
 */
export const laterTodayFloor = (args: {
  /** tenants.same_day_later_reschedule_enabled（`=== true` で渡す。列が読めない環境では出さない） */
  enabled: boolean;
  /** 動かす予約。null＝変更中でない */
  target: { date: string; startTime: string } | null | undefined;
  /** 今日（JST） */
  today: string;
  /** 今の時刻（JST HH:mm） */
  nowTime: string;
}): string | null => {
  const { enabled, target, today, nowTime } = args;
  if (!enabled || !target || target.date !== today) return null;
  // 始まった（開始時刻を過ぎた）予約は動かさない。DB も同じ（now() >= booking_date なら断る）
  if (!target.startTime || target.startTime <= nowTime) return null;
  return target.startTime;
};

export const sameDayRescheduleRule = (args: {
  penaltyEnabled: boolean;
  /** 当日の後ろへ動かせるときの下限（`laterTodayFloor` の答え）。動かせないなら null / 省略 */
  laterFrom?: string | null;
  /** 動かす前の予約の日付 */
  targetDate: string;
  /** 動かす先の日付 */
  newDate: string;
  /** 動かす先の開始時刻（HH:mm） */
  newStart?: string;
  /** 今日（JST） */
  today: string;
}): SameDayRescheduleRule => {
  if (args.targetDate !== args.today) return "normal";
  if (args.newDate === args.targetDate) {
    if (args.laterFrom && args.newStart && args.newStart > args.laterFrom) return "laterToday";
    return args.penaltyEnabled ? "contactGym" : "normal";
  }
  return args.penaltyEnabled ? "forfeit" : "normal";
};

/** `move_booking_later_today` が条件に合わない変更を断るときの SQLSTATE（設定が OFF・始まった・前の時間 等） */
export const LATER_TODAY_SQLSTATE = "GB013";

export const isLaterTodayError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: unknown }).code === LATER_TODAY_SQLSTATE;
