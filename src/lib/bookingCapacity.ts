/**
 * 時間帯別の同時受け入れ数（`booking_capacity_windows`）。
 *
 * `tenants.booking_capacity` は「同じ時間帯に店として受けられる予約の数」を1つの値で
 * 持っているが、実際の店は時間帯で受けられる数が変わる（昼は2人・夜は1人など）。
 * この帯は**その時間の受け入れ枠そのもの**を上書きする。
 *
 * 予約回数の制限（`src/lib/bookingLimits.ts`、GB003）とは目的が違う:
 *   回数の制限 … **お一人が**取りすぎるのを防ぐ（誰の予約かを見る）
 *   容量の帯   … **その時間の枠**を絞る（誰の予約かに関係ない）
 *
 * ## ここにある規則は DB と同じもの
 *
 * 最終判定は DB（`resolve_booking_capacity` → `check_booking_overlap`）。
 * このファイルは同じ規則を画面で先に見せるためにある。規則を変えるときは必ず両方。
 * `src/test/bookingCapacity.test.ts` が両者の一致を見張る。
 */
import { parseTimeToMinutes } from "@/lib/businessHours";

export interface BookingCapacityWindow {
  /** 0=日 … 6=土 */
  weekdays: number[];
  start_time: string;
  /** "24:00" は「その日いっぱい」（終端専用） */
  end_time: string;
  capacity: number;
}

/** 店の既定値が読めないときに倒す先。従来どおり「同時1件」。 */
export const FALLBACK_CAPACITY = 1;

/**
 * その曜日・開始時刻の同時受け入れ数を返す。
 *
 * 🔴 当てはまる帯が複数あれば**最小値**（厳しいほうが勝つ）。
 * 最大値だと、絞るつもりで足した帯が広い帯に負けて効かない、という
 * 「設定したのに効かない」事故になる。予約回数の制限が AND なのと同じ考え方。
 *
 * 時間帯は [start, end) の半開区間 —— 18:00-19:00 の帯は 18:00〜18:59 開始に効き、
 * 19:00 開始には効かない。
 *
 * @param windows   そのジムの帯（`enabled` な行だけを渡すこと。DB/RPC 側で絞る）
 * @param weekday   0=日 … 6=土。null なら帯を当てはめない（既定値を返す）
 * @param startMinutes 予約の開始時刻（0時からの分）
 * @param fallback  当てはまる帯が無いときの値（`tenants.booking_capacity`）
 */
export const resolveSlotCapacity = (
  windows: readonly BookingCapacityWindow[] | null | undefined,
  weekday: number | null,
  startMinutes: number | null,
  fallback: number | null | undefined,
): number => {
  const base = Math.max(
    typeof fallback === "number" && Number.isFinite(fallback) ? Math.floor(fallback) : FALLBACK_CAPACITY,
    1,
  );
  if (!windows || windows.length === 0) return base;
  if (weekday === null || startMinutes === null) return base;

  let smallest: number | null = null;
  for (const w of windows) {
    if (!Array.isArray(w.weekdays) || !w.weekdays.includes(weekday)) continue;
    const start = parseTimeToMinutes(w.start_time);
    const end = parseTimeToMinutes(w.end_time);
    if (start === null || end === null) continue;      // 壊れた行は効かせない（DBが正）
    if (startMinutes < start || startMinutes >= end) continue;
    const cap = Math.floor(w.capacity);
    if (!Number.isFinite(cap) || cap < 1) continue;    // 0以下は無視（DBのCHECKで入らないはず）
    if (smallest === null || cap < smallest) smallest = cap;
  }
  return smallest ?? base;
};
