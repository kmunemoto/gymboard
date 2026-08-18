/**
 * 営業時間（tenants.operating_hours）から、予約枠を並べる範囲を求める。
 *
 * ## なぜ1箇所に集めるのか（2026-08-15）
 *
 * **6箇所すべてが別々の数字を直書きしていた。**
 *
 * | 画面 | 直書き | 実際に出ていた範囲 |
 * |---|---|---|
 * | 予約を追加（TrainerSchedule） | `600 → 1260` | 10:00〜21:00 |
 * | 体験予約（TrialBooking） | `600 → 1260` | 10:00〜21:00 |
 * | ドロップイン（DropInBooking） | `600 → 1260` | 10:00〜21:00 |
 * | 週表示（TrainerSchedule） | `600 → 1335` | 10:00〜22:15 |
 * | ブロック枠 開始（TrainerSchedule） | `600 → 1335` | 10:00〜22:15 |
 * | ブロック枠 終了（TrainerSchedule） | `→ 1290` | 〜22:30 |
 *
 * 営業時間を 23:00 にしても、これらは永久に上の時刻で止まる。
 * 設定画面には「お客様の予約画面に表示される営業時間」と書いてあるのに、
 * **お客様側（CustomerBooking）だけが営業時間を読んでいて、店側は読んでいなかった。**
 * つまり「お客様は 22:00 で予約できるのに、店の予約追加画面には 21:00 までしか出ない」
 * という食い違いが起きていた（宗本さんが実機で発見）。
 *
 * ## 分を捨てない
 *
 * CustomerBooking の `parseHour` は `"22:30".split(":")[0]` で**時だけ**を取り、
 * 分を黙って捨てていた。設定画面は 30分刻みで保存できるので、
 * `22:30` を指定すると `22:00` として扱われる。ここでは分まで解釈する。
 */

/** 営業時間の既定値。設定が無い／壊れているテナント向け。 */
export const DEFAULT_OPEN_MINUTES = 10 * 60; // 10:00
export const DEFAULT_CLOSE_MINUTES = 21 * 60; // 21:00

/** 枠を並べる刻み（分）。営業時間とは独立した表示上の粒度。 */
export const SLOT_STEP_MINUTES = 15;

export interface OperatingHours {
  start?: string | null;
  end?: string | null;
}

/**
 * `"HH:MM"` を0時からの分に変換する。**分を捨てない。**
 * 解釈できない値（空・`"あ"`・`"25:00"`・`"10:70"`）は null を返す。
 */
export const parseTimeToMinutes = (t?: string | null): number | null => {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
};

/** 営業時間を分に解決する（不正値・逆転は既定値に落とす）。 */
export const resolveBusinessMinutes = (
  hours?: OperatingHours | null,
): { open: number; close: number } => {
  const open = parseTimeToMinutes(hours?.start) ?? DEFAULT_OPEN_MINUTES;
  const close = parseTimeToMinutes(hours?.end) ?? DEFAULT_CLOSE_MINUTES;
  // 終業が開店以前だと枠が1つも出ない（画面が真っ白になる）。既定値に戻す。
  if (close <= open) return { open: DEFAULT_OPEN_MINUTES, close: DEFAULT_CLOSE_MINUTES };
  return { open, close };
};

/**
 * **予約枠**（お客様の予約・予約を追加・体験・ドロップイン）の開始時刻を並べる。
 *
 * 施術が終業までに終わる必要があるので、最後の開始は `終業 − 枠の長さ`。
 * 例: 営業 10:00-23:00 / 枠60分 → 最後は 22:00（22:00+60分=23:00）。
 */
export const bookingSlotMinutes = (
  hours: OperatingHours | null | undefined,
  slotMinutes: number,
  step: number = SLOT_STEP_MINUTES,
): number[] => {
  const { open, close } = resolveBusinessMinutes(hours);
  const lastStart = close - slotMinutes;
  const out: number[] = [];
  for (let m = open; m <= lastStart; m += step) out.push(m);
  return out;
};

/**
 * **営業時間そのもの**を並べる（週表示の行・ブロック枠の開始）。
 *
 * 予約枠と違って施術の長さを引かない。ブロック枠は「休憩」「設営」なので、
 * 終業ちょうどまで置けてよい。最後は `終業 − 刻み`（終業ちょうどに開始はできない）。
 */
export const businessGridMinutes = (
  hours: OperatingHours | null | undefined,
  step: number = SLOT_STEP_MINUTES,
): number[] => {
  const { open, close } = resolveBusinessMinutes(hours);
  const out: number[] = [];
  for (let m = open; m <= close - step; m += step) out.push(m);
  return out;
};

/**
 * ブロック枠の**終了**時刻を並べる（開始より後、終業まで）。
 * 終業ちょうどで終われる。
 */
export const blockEndMinutes = (
  hours: OperatingHours | null | undefined,
  startMinutes: number,
  step: number = SLOT_STEP_MINUTES,
): number[] => {
  const { close } = resolveBusinessMinutes(hours);
  const out: number[] = [];
  for (let m = startMinutes + step; m <= close; m += step) out.push(m);
  return out;
};

/** 分を `"HH:MM"` に戻す。 */
export const minutesToTime = (total: number): string => {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
