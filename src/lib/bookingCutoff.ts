/**
 * 予約の締切（`tenants.booking_cutoff_type` / `booking_cutoff_hours`）。
 *
 * ## 経緯（2026-08-03）
 *
 * この2列はオンボーディングの step2 で店に聞いて保存していたのに、
 * **予約ロジックが一度も読んでいなかった**（死んだ列）。
 * 締切判定は CustomerBooking / TrialBooking / DropInBooking の3箇所に
 * 同じコードが複製されていて、中身は全部これだった:
 *
 *     const bookingDayStart = new Date(`${date}T00:00:00+09:00`).getTime();
 *     return Date.now() >= bookingDayStart;   // = 当日以降は問答無用で締切
 *
 * つまり **どの店も当日予約を一切受けられなかった。**
 * 店が「2時間前まで」と答えていても無視されていた。
 *
 * ## 仕様
 *
 * | `booking_cutoff_type` | 意味 |
 * |---|---|
 * | `prev_day`（既定） | 予約日の 0:00 JST を過ぎたら、その日は全部締切 |
 * | `hours_before` | **枠の開始時刻**の `booking_cutoff_hours` 時間前を過ぎたら、その枠は締切 |
 *
 * `hours_before` かつ `hours = 0` は「開始時刻まで受け付ける」（オンボーディングの「制限なし」）。
 *
 * **値が読めないときは `prev_day` に倒す。** 従来の挙動と完全に一致するので、
 * 列が無い環境・未ログイン・読み込み中でも既存の店の挙動が変わらない
 * （`tenantColumns.ts` が capacity を 1 にフォールバックさせるのと同じ考え方）。
 *
 * ## 注意
 *
 * **これは事前チェックのUXでしかない。** DB 側に締切の強制は無いので、
 * ここを通り抜けた予約は成立する。二重予約を実際に防いでいる
 * `check_booking_overlap` トリガーとは別物。
 */

export type BookingCutoff = {
  type?: string | null;
  hours?: number | null;
};

/** 既定。列が読めないときはこれ（＝2026-08-03 以前の挙動と同一）。 */
export const DEFAULT_CUTOFF: BookingCutoff = { type: "prev_day", hours: 24 };

const JST_MIDNIGHT = (dateKey: string) => new Date(`${dateKey}T00:00:00+09:00`).getTime();

const HOUR_MS = 60 * 60 * 1000;

/** "HH:MM" → 0時からの分。壊れた値は 0 扱い（呼び出し側で枠は生成済みのため）。 */
function toMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function normalize(cutoff: BookingCutoff | null | undefined): { type: string; hours: number } {
  const type = cutoff?.type === "hours_before" ? "hours_before" : "prev_day";
  // 負値・NaN は 0 に丸める（0 = 開始時刻まで受け付ける）
  const raw = cutoff?.hours;
  const hours = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
  return { type, hours };
}

/**
 * その枠が締切を過ぎているか。
 *
 * @param dateKey `yyyy-MM-dd`
 * @param time    枠の開始時刻 `HH:MM`
 */
export function isSlotPastCutoff(
  dateKey: string,
  time: string,
  cutoff: BookingCutoff | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!dateKey) return false;
  const { type, hours } = normalize(cutoff);

  if (type === "prev_day") {
    return now >= JST_MIDNIGHT(dateKey);
  }

  const slotStart = JST_MIDNIGHT(dateKey) + toMinutes(time) * 60 * 1000;
  return now >= slotStart - hours * HOUR_MS;
}

/**
 * その日が丸ごと締切か。カレンダーで日付を選べなくする用。
 *
 * `hours_before` では「その日の最後の枠」が締切を過ぎて初めて日全体が閉じる。
 * 最終枠が分からない場合は 24:00 とみなす（＝日を残す側に倒す）。
 * 個々の枠は `isSlotPastCutoff` が引き続き落とすので、
 * 「選べるが空き枠が無い日」になるだけで、予約が通ってしまうことは無い。
 *
 * @param dayEndMinutes その日の最終枠の開始時刻（0時からの分）。省略時は 24:00。
 */
export function isDayPastCutoff(
  dateKey: string,
  cutoff: BookingCutoff | null | undefined,
  now: number = Date.now(),
  dayEndMinutes: number = 24 * 60,
): boolean {
  if (!dateKey) return false;
  const { type, hours } = normalize(cutoff);

  if (type === "prev_day") {
    return now >= JST_MIDNIGHT(dateKey);
  }

  const lastSlotStart = JST_MIDNIGHT(dateKey) + dayEndMinutes * 60 * 1000;
  return now >= lastSlotStart - hours * HOUR_MS;
}
