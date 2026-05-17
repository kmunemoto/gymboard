/**
 * JST (Asia/Tokyo, UTC+9) time utilities.
 *
 * Why this exists:
 *   The app is operated in Japan and all booking/cycle/streak/today logic
 *   must be evaluated against Japan wall-clock time, regardless of where
 *   the user's device is located (台湾 etc.). Plain `new Date()` and
 *   `date-fns` formatting use the device's local timezone, which leaks
 *   timezone bugs into "today" highlighting, cycle windows, streaks,
 *   "latest training" comparisons, history grouping by date, etc.
 *
 * Strategy:
 *   We expose a "JST proxy Date": a Date object whose UTC instant has been
 *   shifted so that calling `.getHours() / .getDate() / .getDay() / ...`
 *   on it returns the JST wall-clock fields. This means we can keep using
 *   date-fns (`format`, `startOfWeek`, `differenceInDays`, ...) and they
 *   "just work" as if the viewer were in Asia/Tokyo.
 *
 * IMPORTANT:
 *   - The numeric `.getTime()` of a JST proxy is NOT the real instant —
 *     it is shifted. Never use it for absolute time math against UTC ISO
 *     strings.
 *   - Use `toJSTDate()` whenever you need to display or compare a stored
 *     UTC ISO string by JST calendar fields (yyyy-MM-dd, HH:mm, weekday).
 *   - Database writes should keep using real `new Date().toISOString()`.
 */

import { format as fnsFormat } from "date-fns";

const JST_OFFSET_MIN = 9 * 60;

/** Return a JST proxy Date for the current moment. */
export const getJSTNow = (): Date => {
  const real = new Date();
  return new Date(real.getTime() + (real.getTimezoneOffset() + JST_OFFSET_MIN) * 60_000);
};

/** Convert any Date / ISO string to a JST proxy Date. */
export const toJSTDate = (input: Date | string | number | null | undefined): Date => {
  if (input == null) return getJSTNow();
  const d = input instanceof Date ? input : new Date(input);
  return new Date(d.getTime() + (d.getTimezoneOffset() + JST_OFFSET_MIN) * 60_000);
};

/** "yyyy-MM-dd" for today in JST. */
export const getJSTToday = (): string => fnsFormat(getJSTNow(), "yyyy-MM-dd");

/** date-fns format wrapper that always formats by JST wall-clock. */
export const formatJST = (
  input: Date | string | number,
  fmt: string,
  options?: Parameters<typeof fnsFormat>[2],
): string => fnsFormat(toJSTDate(input), fmt, options);

/**
 * Get the integer hour (0-23) in JST for a given moment.
 * Useful for "what time is it in Japan now" guards.
 */
export const getJSTHour = (input?: Date | string | number): number =>
  toJSTDate(input ?? new Date()).getHours();
