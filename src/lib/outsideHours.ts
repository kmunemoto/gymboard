import {
  DAY_END_MINUTES,
  SLOT_STEP_MINUTES,
  minutesToTime,
  resolveDayBusinessMinutes,
  weekdayOfDateKey,
  type OperatingHours,
} from "./businessHours";

/**
 * 営業時間外の予約（店がイレギュラーで入れるもの）。2026-10-17
 *
 * 宗本さん「イレギュラーで営業時間外に予約をジム側で手入力で入れられる機能」。
 * 決めたこと:
 *   1. 時間外の予約も「1日の上限」に**数える**（会員の上限・体験込みの合計・週の多い日のすべて）。
 *      🔴 2026-10-17 は「数えない」で入れたが、5件入った日に6件目の体験が通ったため、
 *      2026-10-23 に宗本さん「全ての予約を合わせて1日5枠まで」「会員の4枠にも数える」で改めた
 *   2. 定休日にも入れられる（定休日は1日中が「時間外」）
 *
 * 🔴 印（bookings.outside_hours）を付けられるのは店のスタッフだけ（DB の guard_booking_outside_hours_flag）。
 * 🔴 日付をまたぐ予約（23:30 開始で翌 0:30 終了など）は作らない。予定表は1日単位で並べている。
 */

export interface OutsideHoursStarts {
  /** 定休日（1日中が時間外） */
  closedDay: boolean;
  /** 開店前にかかる開始時刻（分） */
  before: number[];
  /** 閉店後にかかる開始時刻（分）。定休日は1日中をここに入れる */
  after: number[];
}

/**
 * その日に「営業時間外の予約」として選べる開始時刻。sessionMinutes はプランの長さ＋オプション。
 * - 営業時間の中に収まる開始時刻は入れない（それは普通の枠で取れる）
 * - 開店前から営業時間にかかるもの（9:30〜10:30 など）・閉店をまたぐもの（22:00〜23:00 など）は入れる
 * - 終了が 24:00 を超えるものは入れない
 */
export function outsideHoursStarts(
  hours: OperatingHours | null | undefined,
  dateKey: string,
  sessionMinutes: number,
  step: number = SLOT_STEP_MINUTES,
): OutsideHoursStarts {
  const duration = Math.max(step, Math.floor(sessionMinutes) || 0);
  const day = resolveDayBusinessMinutes(hours, weekdayOfDateKey(dateKey));
  const before: number[] = [];
  const after: number[] = [];
  for (let m = 0; m + duration <= DAY_END_MINUTES; m += step) {
    if (!day) { after.push(m); continue; }
    const inside = m >= day.open && m + duration <= day.close;
    if (inside) continue;
    (m < day.open ? before : after).push(m);
  }
  return { closedDay: !day, before, after };
}

/** その開始時刻の予約が営業時間外（一部でもかかる・定休日）か */
export function isOutsideBusinessHours(
  hours: OperatingHours | null | undefined,
  dateKey: string,
  startMinutes: number,
  sessionMinutes: number,
): boolean {
  const day = resolveDayBusinessMinutes(hours, weekdayOfDateKey(dateKey));
  if (!day) return true;
  return startMinutes < day.open || startMinutes + sessionMinutes > day.close;
}

/** 終了時刻（"HH:mm"）。開始＋長さ */
export const endTimeOf = (startMinutes: number, sessionMinutes: number): string =>
  minutesToTime(startMinutes + sessionMinutes);

/**
 * 予定表の行（"HH:mm"）に、表示中の予約の開始時刻を足す。
 * 行を営業時間からだけ作ると、営業時間外の予約（や刻みに乗らない開始時刻）が表に出ない。
 */
export function withBookingStartTimes(rows: string[], bookings: ReadonlyArray<{ startTime: string }>): string[] {
  const set = new Set(rows);
  for (const b of bookings) if (/^\d{2}:\d{2}$/.test(b.startTime)) set.add(b.startTime);
  return [...set].sort();
}
