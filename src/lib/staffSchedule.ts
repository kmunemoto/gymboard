/**
 * スタッフ別の受付可否（シフト）。`staff_schedules` テーブルの解釈を1箇所に集める。
 *
 * ## なぜ必要か（2026-08-20）
 *
 * 担当スタッフの指名（`bookings.staff_user_id`、2026-08-04）は入っているのに、
 * **「そのスタッフがいつ働いているか」という概念がどこにも無かった。**
 * 火・木しか出ていないトレーナーでも、月曜の枠に指名予約が入ってしまう。
 * 指名を実際に使い始めた店が必ず踏む穴なので、営業時間の曜日別対応
 * （`src/lib/businessHours.ts`）と同じ仕組みで塞ぐ。
 *
 * ## 🔴 行が1つも無いスタッフは「営業時間どおり」
 *
 * これが最重要の後方互換ルール。既存のスタッフには当然1行も無いので、
 * 「行が無い＝働けない」と解釈すると**適用した瞬間に全店の指名予約が取れなくなる**。
 *
 * | そのスタッフの行 | 解釈 |
 * |---|---|
 * | 0件 | 営業時間どおり（＝シフト未設定。従来の挙動） |
 * | 1件以上 | **書いてある曜日だけ**働く。書いていない曜日は休み |
 *
 * 「シフトを設定する」＝「働く曜日を列挙する」。全部消せば未設定に戻る。
 *
 * ## 店の営業時間との関係は「積集合」
 *
 * スタッフが 8:00-23:00 と書いても、店が 10:00-21:00 なら 10:00-21:00 でしか取れない。
 * 逆に店が開いていてもスタッフが休みなら取れない。**両方を満たす時間だけ**が枠になる。
 * 定休日（店が閉まっている日）はスタッフの行に関係なく取れない。
 */
import {
  type OperatingHours,
  parseTimeToMinutes,
  resolveDayBusinessMinutes,
} from "@/lib/businessHours";

/** `staff_schedules` の1行。**行があること自体が「その曜日は働く」の意味。** */
export interface StaffScheduleRow {
  user_id: string;
  /** 0=日 … 6=土（JS の `Date.getDay()` と同じ）。 */
  weekday: number;
  /** `"HH:MM"`。 */
  start_time: string;
  /** `"HH:MM"`。 */
  end_time: string;
}

/** そのスタッフがシフトを設定しているか（1行でもあれば true）。 */
export const hasStaffShift = (
  schedules: ReadonlyArray<StaffScheduleRow> | null | undefined,
  staffUserId: string | null | undefined,
): boolean => {
  if (!schedules || !staffUserId) return false;
  return schedules.some((s) => s.user_id === staffUserId);
};

/**
 * **そのスタッフが、その曜日に、実際に予約を受けられる時間**（分）。受けられなければ null。
 *
 * @param hours       店の営業時間（`tenants.operating_hours`）
 * @param weekday     0=日 … 6=土。null なら曜日を問わない＝店の包絡線をそのまま返す
 * @param schedules   テナント全員ぶんでよい（内部で staffUserId で絞る）
 * @param staffUserId 指名なし（null）のときは店の営業時間をそのまま返す
 */
export const staffDayMinutes = (
  hours: OperatingHours | null | undefined,
  weekday: number | null | undefined,
  schedules: ReadonlyArray<StaffScheduleRow> | null | undefined,
  staffUserId: string | null | undefined,
): { open: number; close: number } | null => {
  const store = resolveDayBusinessMinutes(hours, weekday);
  // 定休日は誰も受けられない。指名なしなら店の営業時間がそのまま答え。
  if (!store) return null;
  if (!staffUserId) return store;
  if (!hasStaffShift(schedules, staffUserId)) return store; // シフト未設定＝営業時間どおり
  if (weekday == null) return store; // 曜日が決まっていないなら狭められない（包絡線のまま）

  const rows = (schedules ?? []).filter(
    (s) => s.user_id === staffUserId && s.weekday === weekday,
  );
  if (rows.length === 0) return null; // シフトはあるが、この曜日は休み

  // 同じ曜日に複数行があれば、いちばん広い範囲を採る（分割シフトは持たない）。
  let open: number | null = null;
  let close: number | null = null;
  for (const r of rows) {
    const o = parseTimeToMinutes(r.start_time);
    const c = parseTimeToMinutes(r.end_time);
    if (o === null || c === null || c <= o) continue;
    open = open === null ? o : Math.min(open, o);
    close = close === null ? c : Math.max(close, c);
  }
  // 行はあるが全部壊れていた場合は、店を丸ごと止めないよう営業時間に倒す。
  if (open === null || close === null) return store;

  // 店の営業時間との積集合。重ならなければその日は受けられない。
  const lo = Math.max(open, store.open);
  const hi = Math.min(close, store.close);
  if (hi <= lo) return null;
  return { open: lo, close: hi };
};

/** そのスタッフがその曜日に働くか（枠が1つも無い曜日は false）。 */
export const staffWorksOnWeekday = (
  hours: OperatingHours | null | undefined,
  weekday: number | null | undefined,
  schedules: ReadonlyArray<StaffScheduleRow> | null | undefined,
  staffUserId: string | null | undefined,
): boolean => staffDayMinutes(hours, weekday, schedules, staffUserId) !== null;

/**
 * 指名したスタッフで実際に選べる**予約枠の開始時刻**（分）。
 *
 * `bookingSlotMinutes` の担当者版。指名なし・シフト未設定なら結果は同じになる。
 */
export const staffBookingSlotMinutes = (
  hours: OperatingHours | null | undefined,
  slotMinutes: number,
  weekday: number | null | undefined,
  schedules: ReadonlyArray<StaffScheduleRow> | null | undefined,
  staffUserId: string | null | undefined,
  step = 15,
): number[] => {
  const day = staffDayMinutes(hours, weekday, schedules, staffUserId);
  if (!day) return [];
  const lastStart = day.close - slotMinutes;
  const out: number[] = [];
  for (let m = day.open; m <= lastStart; m += step) out.push(m);
  return out;
};

/**
 * DB が「担当者のシフト外」で拒否したか。
 *
 * SQLSTATE `GB002`（`20260820020000_staff_schedules.sql` がこの用途専用に付けている）。
 * 満枠（文言一致しない `GB001`）と混ぜないのは、お客様への案内が変わるため
 * （満枠＝別の時間、シフト外＝別の担当か別の曜日）。
 */
export const isStaffOffShiftError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "GB002";

/** 週の表示順（月曜始まり）。設定画面と一覧で共通に使う。 */
export const SHIFT_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
