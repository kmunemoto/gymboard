/**
 * その日の受付を止める（`booking_closed_days` と `tenants.daily_booking_limit`）。
 *
 * 実店舗の要望（2026-09-01 宗本さん）: パーソナルジムは1日に見られる人数に限りがある。
 * 枠が空いていても「今日はもう受けない」と決めたい。blocked_slots に枠を1つずつ
 * 入れて塞ぐのは操作が多すぎる。
 *
 * 止め方は2つあるが、**お客様から見れば同じ「受付終了」**なので1つに束ねている:
 *   手で閉めた（manual）… その日をワンタップで閉めた。ワンタップで解除できる
 *   上限に達した          … その日の会員予約が `daily_booking_limit` に届いた
 *
 * ## 🔴 体験・ドロップインは仕組みから完全に外れている（2026-09-01）
 *
 * 宗本さんの指示:「体験予約はこのシステムの例外にします。体験予約は上限なく受け付けます」。
 * したがって体験・ドロップインは **止まらないし、1日の人数にも数えない**。
 * 上限5人の日に体験が3件入っても、会員はまだ5人まで取れる（合計は5人を超える）。
 *
 * 体験とドロップインは**同じ `trial_bookings` テーブル**にあり（`booking_kind` で区別）、
 * 画面側は両者を区別せず `user_id === "trial-guest"` として扱っている。DB だけ
 * `booking_kind` で分けると、画面の人数と DB の判定がずれる——このリポジトリで最も
 * 避けたいズレ（画面は空きと見せるのに DB が拒否する）。本番のドロップインは0件なので、
 * テーブルごと外している。分けたくなったら useBookings に `booking_kind` を運ばせてから、
 * DB と画面を同時に変えること。
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
 * 最終判定は DB（`tenant_day_closed` → `guard_booking_day_closed`、SQLSTATE `GB007`。
 * `trial_bookings` にトリガーは無い）。このファイルは同じ規則を
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

/**
 * 予約変更のときに、その日を塞ぐべきか。
 *
 * 実店舗の要望（2026-09-05 宗本さん）:
 *
 * > 一日四枠までに設定したら、四枠入っている日はグレーになって押せなくなる。
 * > 当日でもグレーで、何時が空いているか分からない。
 * > その日に予約している人が、時間を後ろにずらせるか確認したいらしい。
 *
 * 🔴 **「受付終了」は2種類あって、DB の扱いが違う。** 一律に解除してはいけない。
 *
 * | 種類 | `manual` | 同じ日への予約変更 |
 * |---|---|---|
 * | 上限に達した（4/4） | `false` | **DB は通す** |
 * | 店がワンタップで止めた | `true`  | **DB が断る**（GB007） |
 *
 * 上限のほうを DB が通すのは、`tenant_day_closed(tenant, date, p_exclude_booking_id)` が
 * **動かす予約自身を数えずに**上限と比べるから（4枠のうち1枠は自分なので実質 3/4）。
 * 店が手で止めた日は `booking_closed_days` に行があり、除外とは無関係に閉まったまま。
 *
 * ここを一律に解除すると、**手で止めた日で「押せたのにサーバーに断られる」**が起きる。
 * DB の判定と1対1で対応させること。
 *
 * @param rescheduleFromDate 動かそうとしている予約の日（yyyy-MM-dd）。
 *                           予約変更中でなければ null を渡す。
 */
export const isDayClosedForBooking = (
  closedDays: readonly ClosedDay[] | null | undefined,
  dateKey: string,
  rescheduleFromDate: string | null,
): boolean => {
  const day = closedDays?.find((d) => d.closed_date === dateKey);
  if (!day) return false;
  // 手で止めた日は、予約変更でも開けない（DB が GB007 で断るため）
  if (day.manual) return true;
  // 上限で閉まった日は、**そこに自分の予約がある**ときだけ開ける。
  // 別の日から動かしてくる場合は、自分を除いても上限のままなので閉じたまま。
  return rescheduleFromDate !== dateKey;
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
 *
 * ⚠️ これは**会員予約の行だけに使うこと**。体験・ドロップインの行は呼び出す前に
 *    落とす（`useDayReception` を参照）。この関数は status しか見ないので、
 *    体験行を渡すと数に入ってしまう。
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
