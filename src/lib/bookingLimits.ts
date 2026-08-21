/**
 * 予約回数の制限（booking_frequency_limits）。
 *
 * 「平日の 18:00〜19:00 は1週間に1回まで」のように、混み合う時間帯に
 * お一人が取れる予約の回数を店が制限できる（2026-08-21、実店舗の要望）。
 * 週2回来る会員がピーク帯を週2枠とも取ってしまい、他の会員がその時間帯を
 * 一度も取れない、という問題への対処。
 *
 * ## ルールの形
 *
 *   曜日の集合 × 時間帯 [start, end) × 期間（週 or 日）× 回数上限
 *     × 対象（user_id null = 全員 / 非null = そのお客様だけ）× enabled
 *
 * ## ここにある規則は DB トリガーと同じもの
 *
 * 最終判定は DB（`guard_booking_frequency_limit`、SQLSTATE `GB003`）。
 * このファイルは**同じ規則をお客様の画面で先に見せる**ためにある（枠を押してから
 * 断られるより、押せないほうが分かりやすい）。規則を変えるときは必ず両方を変える。
 * `src/test/bookingLimits.test.ts` が両者の一致を見張る。
 *
 * 🔴 判定に使う既存予約の除外は `status === 'キャンセル済み'` **だけ**。
 * 「同日キャンセル済み」（消化）は数える。満枠判定（check_booking_overlap）と
 * 同じ除外規則で、消化はセッションを使った扱いなので回数も使ったと数える。
 *
 * 🔴 店側の代理予約（TrainerSchedule）には適用しない。トリガーも
 * auth.uid() = user_id の自己予約だけを見る。店が電話で受けるぶんは店の裁量。
 */
import { parseTimeToMinutes, weekdayOfDateKey } from "@/lib/businessHours";

export interface BookingFrequencyLimitRow {
  id: string;
  /** null = ジムの全お客様 / 非null = そのお客様だけ */
  user_id: string | null;
  /** 0=日 … 6=土 */
  weekdays: number[];
  start_time: string;
  /** "24:00" は「その日いっぱい」（終端専用） */
  end_time: string;
  period: "week" | "day";
  max_bookings: number;
  enabled: boolean;
  /**
   * true = この行は「制限」ではなく **免除**。そのお客様はこの曜日×時間帯で
   * 他のどのルールも受けない（免除は制限より強い）。
   * 免除は必ず `user_id` を伴う（全員免除はルールを消すのと同じなので DB の CHECK で禁止）。
   */
  exempt?: boolean;
}

/** 回数に数えない status。トリガー側の `status <> 'キャンセル済み'` と対。 */
const CANCELLED_STATUS = "キャンセル済み";

/** 判定に必要なぶんだけの予約の形（useBookings の BookingWithTime が満たす） */
export interface LimitCheckBooking {
  id: string;
  /** "yyyy-MM-dd"（JSTの暦日） */
  date: string;
  /** "HH:MM"（JSTの壁時計） */
  startTime: string;
  status: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 日付キーに日数を足す。
 * 🔴 `new Date("yyyy-MM-dd")` のローカル解釈を使わない。日付キーは既に
 * JST の暦日でタイムゾーンを持たないので、UTC に置いて計算する
 * （weekdayOfDateKey と同じ理由。CI は UTC・端末は JST で走る）。
 */
export const addDaysToDateKey = (dateKey: string, days: number): string => {
  const [y, mo, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

/**
 * その日付が属する期間の [from, to) を日付キーで返す。
 * week は**月曜始まり**（このアプリの週は全箇所 weekStartsOn: 1。
 * DB 側も date_trunc('week') = ISO 週で一致）。
 */
export const limitPeriodRange = (
  period: "week" | "day",
  dateKey: string,
): { fromKey: string; toKey: string } | null => {
  const wd = weekdayOfDateKey(dateKey);
  if (wd === null) return null;
  if (period === "day") {
    return { fromKey: dateKey, toKey: addDaysToDateKey(dateKey, 1) };
  }
  // 月曜=1 → 0日戻る、日曜=0 → 6日戻る
  const backToMonday = (wd + 6) % 7;
  const fromKey = addDaysToDateKey(dateKey, -backToMonday);
  return { fromKey, toKey: addDaysToDateKey(fromKey, 7) };
};

/**
 * このルールがその予約（曜日・開始時刻・予約者）にマッチするか。
 * 時間帯は [start, end) の半開区間 —— 18:00-19:00 のルールは
 * 18:00〜18:59 開始の予約に効き、19:00 開始には効かない。
 */
export const matchesFrequencyLimit = (
  limit: BookingFrequencyLimitRow,
  weekday: number,
  startMinutes: number,
  userId: string,
): boolean => {
  if (!limit.enabled) return false;
  if (limit.exempt) return false;   // 免除行は「制限」としてはマッチしない（下の isExempt で見る）
  if (limit.user_id !== null && limit.user_id !== userId) return false;
  if (!limit.weekdays.includes(weekday)) return false;
  const start = parseTimeToMinutes(limit.start_time);
  const end = parseTimeToMinutes(limit.end_time);
  if (start === null || end === null) return false;   // 壊れた行は効かせない（DBが正）
  return startMinutes >= start && startMinutes < end;
};

/**
 * この予約（曜日・開始時刻・予約者）に当てはまる**免除**があるか。
 *
 * 🔴 免除は制限より強い。1件でも当てはまれば、その予約は回数の制限を一切受けない。
 * 逆（制限が勝つ）にすると免除を作った意味が無くなる。DB のトリガーも
 * 制限ループの**前**に同じ判定を置いている。
 */
export const isExemptFromFrequencyLimits = (
  limits: readonly BookingFrequencyLimitRow[] | null | undefined,
  weekday: number,
  startMinutes: number,
  userId: string,
): boolean => {
  if (!limits) return false;
  return limits.some((l) => {
    if (!l.enabled || !l.exempt) return false;
    // 免除は必ず特定のお客様あて（全員免除は DB の CHECK で作れない）
    if (l.user_id === null || l.user_id !== userId) return false;
    if (!l.weekdays.includes(weekday)) return false;
    const start = parseTimeToMinutes(l.start_time);
    const end = parseTimeToMinutes(l.end_time);
    if (start === null || end === null) return false;
    return startMinutes >= start && startMinutes < end;
  });
};

/** ルールの時間帯×曜日×期間に入っている既存予約の件数 */
const countTowardLimit = (
  limit: BookingFrequencyLimitRow,
  range: { fromKey: string; toKey: string },
  bookings: LimitCheckBooking[],
  excludeBookingId?: string | null,
): number => {
  const start = parseTimeToMinutes(limit.start_time);
  const end = parseTimeToMinutes(limit.end_time);
  if (start === null || end === null) return 0;
  return bookings.filter((b) => {
    if (excludeBookingId && b.id === excludeBookingId) return false;   // リスケ中の旧枠
    if (b.status === CANCELLED_STATUS) return false;
    if (b.date < range.fromKey || b.date >= range.toKey) return false;
    const wd = weekdayOfDateKey(b.date);
    if (wd === null || !limit.weekdays.includes(wd)) return false;
    const min = parseTimeToMinutes(b.startTime);
    return min !== null && min >= start && min < end;
  }).length;
};

/**
 * この日時に予約を取ると上限を超えるか。超えるなら**最初に超えたルール**を返す
 * （呼び出し側が案内文を組み立てられるように）。超えないなら null。
 *
 * マッチした全ルールを評価する（AND）。個別ルールは全体ルールへの**追加の**
 * 締め付けで、上書きではない。
 */
export const exceededFrequencyLimit = (
  limits: BookingFrequencyLimitRow[],
  candidate: { dateKey: string; startMinutes: number; userId: string },
  myBookings: LimitCheckBooking[],
  excludeBookingId?: string | null,
): BookingFrequencyLimitRow | null => {
  const weekday = weekdayOfDateKey(candidate.dateKey);
  if (weekday === null) return null;
  // 🔴 免除が先。当てはまれば制限を一切評価しない（DB のトリガーと同じ順序）。
  if (isExemptFromFrequencyLimits(limits, weekday, candidate.startMinutes, candidate.userId)) {
    return null;
  }
  for (const limit of limits) {
    if (!matchesFrequencyLimit(limit, weekday, candidate.startMinutes, candidate.userId)) continue;
    const range = limitPeriodRange(limit.period, candidate.dateKey);
    if (!range) continue;
    const count = countTowardLimit(limit, range, myBookings, excludeBookingId);
    if (count >= limit.max_bookings) return limit;
  }
  return null;
};

/**
 * DB が「予約回数の上限」で拒否したか。
 * SQLSTATE `GB003`（`20260821020000_booking_frequency_limits.sql` がこの用途専用に
 * 付けている）。GB001（担当が満枠）・GB002（担当がシフト外）と混ぜないのは、
 * お客様への案内が変わるため（上限＝別の時間帯なら取れる）。
 */
export const isBookingLimitError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "GB003";
