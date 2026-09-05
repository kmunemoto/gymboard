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

/** その日付が JST の今日か。`getJSTToday()` と同じ規則。 */
const isTodayKey = (dateKey: string): boolean =>
  dateKey === new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

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
 * その日を「日付ごと押せなくする」か。
 *
 * 実店舗の要望（2026-09-05 宗本さん）:
 *
 * > 一日四枠までに設定したら、四枠入っている日はグレーになって押せなくなる。
 * > 当日であってもグレーで、何時が空いてるか分からなくなる。
 * > **当日の日付を押したときに**その日の状況が見えるようにしてほしい。
 * > アプリから当日の予約の変更はできない。
 * > **その日の状況を見て、お客さんはお店に連絡するシステム**。
 *
 * 🔴 **「受付終了」は2種類あって、意味が違う。**
 *
 * | 種類 | `manual` | 当日の扱い |
 * |---|---|---|
 * | 店がワンタップで止めた | `true`  | 押せない（店が「今日はもう受けない」と決めた日） |
 * | 上限に達した（4/4）    | `false` | **当日だけ押せる。中身は見るだけ**（予約はできない） |
 *
 * 上限のほうを当日だけ開けるのは、
 *
 *  - 当日はそもそもアプリから予約も変更もできない（締切済み）ので、
 *    押せても**「見るだけ」以上のことは起きない**
 *  - お客様は空き時間を見て**店に電話する**。その材料を出すのが目的
 *  - 先の日付まで開けると、店が上限で止めた日に問い合わせが増える。
 *    止めた意図に反するので開けない
 */
export const isDayHardClosed = (
  closedDays: readonly ClosedDay[] | null | undefined,
  dateKey: string,
): boolean => {
  const day = closedDays?.find((d) => d.closed_date === dateKey);
  if (!day) return false;
  // 手で止めた日は常に閉じる。上限の日は当日だけ開ける（下の isDayViewOnly）
  return day.manual || !isTodayKey(dateKey);
};

/**
 * 「押せるが、予約はできない（見るだけ）」日か。
 *
 * 当日 かつ 上限で埋まった日 だけ true。呼び出し側は、
 * **枠を描くが1つも押せない**状態にすること（空き枠は「空き」と分かるように出す）。
 */
export const isDayViewOnly = (
  closedDays: readonly ClosedDay[] | null | undefined,
  dateKey: string,
): boolean => {
  const day = closedDays?.find((d) => d.closed_date === dateKey);
  return !!day && !day.manual && isTodayKey(dateKey);
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
