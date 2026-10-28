/**
 * 曜日ごとの会員の1日の上限（`tenants.daily_booking_limit_weekdays`・2026-10-28）。
 *
 * 宗本さん「これ（1日の上限人数）、曜日ごとに上限設定できる様にもして」。確認したこと:
 *   1. 曜日ごとに会員の人数を決める（例: 月5・火6・…・日4）。「週に何日か増やす」も一緒に使える
 *      （曜日の人数より多くできる）
 *   2. 体験も含めた合計の上限（`daily_total_limit`）は**全曜日同じ**のまま
 *
 * 保存の形: `{"0": 4, "2": 6}`。キーは曜日（0=日曜〜6=土曜。`operating_hours.days` と同じ数え方）。
 * キーの無い曜日は `daily_booking_limit`（共通）。NULL＝全曜日共通（今まで通り）。
 *
 * 🔴 判定の正は DB の `tenant_member_day_limits`。ここは設定画面と予定表の「n/◯人」のための写し。
 */

/** 曜日ごとの上限。添字は曜日（0=日曜〜6=土曜）。null の曜日は共通（daily_booking_limit） */
export type WeekdayLimits = ReadonlyArray<number | null>;

/** 1曜日の上限の最大（DB の CHECK と同じ） */
export const WEEKDAY_LIMIT_MAX = 99;

/** 画面に並べる順。週は月曜〜日曜（「週に何日か増やす」と同じ区切り） */
export const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

const isLimit = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= WEEKDAY_LIMIT_MAX;

/** DB の値（jsonb）を7曜日の配列に。曜日の指定が1つも無ければ null（全曜日共通） */
export const parseWeekdayLimits = (raw: unknown): (number | null)[] | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const limits = Array.from({ length: 7 }, (_, d) => (isLimit(obj[String(d)]) ? (obj[String(d)] as number) : null));
  return limits.some((v) => v !== null) ? limits : null;
};

/** 保存する値。曜日の指定が1つも無ければ null（全曜日共通。今まで通り） */
export const weekdayLimitsToJson = (limits: WeekdayLimits | null | undefined): Record<string, number> | null => {
  if (!limits) return null;
  const out: Record<string, number> = {};
  limits.forEach((v, d) => {
    if (isLimit(v)) out[String(d)] = v;
  });
  return Object.keys(out).length > 0 ? out : null;
};

/** "yyyy-MM-dd" の曜日（0=日曜）。端末のタイムゾーンに左右されないよう UTC で数える */
export const weekdayOf = (dateKey: string): number => {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/** 7曜日それぞれの会員の上限（曜日の指定 → なければ共通）。null=上限なし */
export const baseLimits = (dailyLimit: number | null, weekdayLimits: WeekdayLimits | null | undefined): (number | null)[] =>
  Array.from({ length: 7 }, (_, d) => weekdayLimits?.[d] ?? dailyLimit);

/** その日の曜日の会員の上限（「週に何日か増やす」を足す前）。null=上限なし */
export const baseLimitOn = (
  dateKey: string,
  dailyLimit: number | null,
  weekdayLimits: WeekdayLimits | null | undefined,
): number | null => weekdayLimits?.[weekdayOf(dateKey)] ?? dailyLimit;

/** いちばん少ない曜日の上限。上限のある曜日が無ければ null */
export const minBaseLimit = (dailyLimit: number | null, weekdayLimits: WeekdayLimits | null | undefined): number | null => {
  const set = baseLimits(dailyLimit, weekdayLimits).filter((v): v is number => v !== null);
  return set.length > 0 ? Math.min(...set) : null;
};
