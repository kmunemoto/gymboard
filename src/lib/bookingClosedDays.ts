/**
 * その日の受付を止める（`booking_closed_days` と `tenants.daily_booking_limit`）。
 *
 * 実店舗の要望（2026-09-01 宗本さん）: パーソナルジムは1日に見られる人数に限りがある。
 * 枠が空いていても「今日はもう受けない」と決めたい。blocked_slots に枠を1つずつ
 * 入れて塞ぐのは操作が多すぎる。
 *
 * 止め方は2つあるが、**お客様から見れば同じ「受付終了」**なので1つに束ねている:
 *   手で閉めた（manual）… その日をワンタップで閉めた。ワンタップで解除できる
 *   上限に達した          … その日の予約件数が `daily_booking_limit` に届いた
 *
 * 他の予約制限との違い:
 *   容量の帯（bookingCapacity.ts）      … **その時間**に何人まで（同時に受けられる数）
 *   回数の制限（bookingLimits.ts）      … **お一人が**取りすぎるのを防ぐ
 *   受付しない帯（bookingBlockedWindows）… **その時間帯**の開始を受け付けない
 *   ここ                                … **その日ぜんぶ**。時間帯も相手も見ない
 *
 * ## 🔴 店側の代理予約には効かない
 *
 * GB003 / GB004 / GB006 と同じ非対称。「今日はもう受けない」と決めたあとで
 * 常連さんを1人だけ足すのは店の裁量として残す。止まるのは
 * **お客様の自己予約**と**公開の体験・ドロップイン予約**だけ。
 *
 * ## ここにある規則は DB と同じもの
 *
 * 最終判定は DB（`tenant_day_closed` → `guard_booking_day_closed` /
 * `guard_trial_booking_day_closed`、SQLSTATE `GB007`）。このファイルは同じ規則を
 * 画面で先に見せるためにある。規則を変えるときは必ず両方。
 * `src/test/bookingClosedDays.test.ts` が両者の一致を見張る。
 */

/** 受付を終了した日。`get_tenant_closed_days` が返す1行。 */
export interface ClosedDay {
  /** JST の日付（yyyy-MM-dd） */
  closed_date: string;
  /** true=手で閉めた / false=上限に達した */
  manual: boolean;
  reason: string | null;
}

/** その日が受付終了か。手動・上限のどちらでも true。 */
export const isDayClosed = (
  closedDays: readonly ClosedDay[] | null | undefined,
  dateKey: string,
): boolean => {
  if (!closedDays || closedDays.length === 0 || !dateKey) return false;
  return closedDays.some((d) => d.closed_date === dateKey);
};

/** その日を止めた理由。閉まっていなければ null。 */
export const closedDayReason = (
  closedDays: readonly ClosedDay[] | null | undefined,
  dateKey: string,
): ClosedDay | null => {
  if (!closedDays || !dateKey) return null;
  return closedDays.find((d) => d.closed_date === dateKey) ?? null;
};

/**
 * 予約1件をその日の人数として数えるか。
 *
 * 🔴 数えるのは `status !== 'キャンセル済み'`。DB の `tenant_day_booking_count` と
 *    **文字どおり同じ条件**にしてある。つまり「同日キャンセル済み」（消化扱い）は
 *    **数える**。予定表に枠として残り続けるものを空きとして数えると、
 *    受付終了にしたはずの日がひとりでに開いてしまう。
 */
export const countsTowardDailyLimit = (status: string | null | undefined): boolean =>
  status !== "キャンセル済み";

/**
 * その日の残り受付可能件数。上限が無ければ null（＝制限なし）。
 * 予定表に「あと1人」と出すためのもので、判定そのものは DB が持つ。
 */
export const remainingForDay = (
  limit: number | null | undefined,
  bookedCount: number,
): number | null => {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) return null;
  return Math.max(0, limit - Math.max(0, bookedCount));
};

/** 上限に達しているか（画面で先に「受付終了」を出すため）。 */
export const isDayAtLimit = (
  limit: number | null | undefined,
  bookedCount: number,
): boolean => {
  const remaining = remainingForDay(limit, bookedCount);
  return remaining !== null && remaining <= 0;
};

/** DB が返す「この日は受付を終了しました」の SQLSTATE。 */
export const DAY_CLOSED_SQLSTATE = "GB007";

/** 保存に失敗したのが「受付終了」によるものか。エラー案内の出し分けに使う。 */
export const isDayClosedError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === DAY_CLOSED_SQLSTATE) return true;
  return typeof e.message === "string" && e.message.includes("受付を終了");
};
