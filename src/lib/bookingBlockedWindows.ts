/**
 * 受付しない時間帯（`booking_blocked_windows`）。
 *
 * 実店舗の要望（2026-08-21）: 平日の夜は 60分＋間隔15分で、誰かが 19:00 に取ると
 * その1件が「前は早すぎる」「後は遅すぎる」の間を独占して夜が1枠に潰れる。
 * **開始時刻を 18:15 と 19:30 に揃えれば**、18:15の回（〜19:15＋間隔15分）の直後に
 * 19:30の回が始まり、隙間ゼロで夜が必ず2枠になる。
 * そこで「この2つの時刻の**間**に始まる予約を受け付けない」帯を店が置ける。
 *
 * ## 🔴 帯は**開区間 (start, end)** —— 両端ちょうどの開始は受け付ける
 *
 * 両端こそが「残したい2枠」そのもの。18:15〜19:30 の帯は 18:30〜19:15 開始を塞ぎ、
 * 18:15 開始と 19:30 開始は取れる。時間帯の区間規則は機能ごとに意味で使い分ける:
 *
 *   容量の帯（bookingCapacity.ts）  … [start, end) 半開。スタッフが居る期間
 *   回数の制限（bookingLimits.ts）  … [start, end] 閉区間。制限する開始時刻の範囲
 *   受付しない帯（このファイル）    … (start, end) 開区間。残す2枠の「間」
 *
 * ## ここにある規則は DB トリガーと同じもの
 *
 * 最終判定は DB（`guard_booking_blocked_window`、SQLSTATE `GB006`）。
 * このファイルは同じ規則をお客様の画面で先に見せるためにある（枠を「受付外」表示に
 * する）。規則を変えるときは必ず両方。`src/test/bookingBlockedWindows.test.ts` が見張る。
 *
 * 🔴 店側の代理予約には適用しない（GB003/GB004 と同じ非対称。事情のある方を
 * 帯の中に入れてあげるのは店の裁量）。免除（bookingLimits の exempt 行）は
 * この帯より強い —— 呼び出し側が `isExemptFromFrequencyLimits` を先に見ること。
 */
import { parseTimeToMinutes } from "@/lib/businessHours";

export interface BookingBlockedWindow {
  /** 0=日 … 6=土 */
  weekdays: number[];
  start_time: string;
  end_time: string;
}

/**
 * この帯がその開始時刻（曜日・分）を塞ぐか。
 * 🔴 開区間 —— start・end **ちょうど**の開始には効かない（残したい2枠そのもの）。
 */
export const matchesBlockedWindow = (
  w: BookingBlockedWindow,
  weekday: number,
  startMinutes: number,
): boolean => {
  if (!Array.isArray(w.weekdays) || !w.weekdays.includes(weekday)) return false;
  const start = parseTimeToMinutes(w.start_time);
  const end = parseTimeToMinutes(w.end_time);
  if (start === null || end === null) return false;   // 壊れた行は効かせない（DBが正）
  return startMinutes > start && startMinutes < end;
};

/** その曜日・開始時刻がどれかの帯に塞がれているか */
export const isBlockedStart = (
  windows: readonly BookingBlockedWindow[] | null | undefined,
  weekday: number | null,
  startMinutes: number | null,
): boolean => {
  if (!windows || windows.length === 0) return false;
  if (weekday === null || startMinutes === null) return false;
  return windows.some((w) => matchesBlockedWindow(w, weekday, startMinutes));
};

/**
 * DB が「受付しない時間帯」で拒否したか。
 * SQLSTATE `GB006`。GB003（回数上限）と混ぜないのは、お客様への案内が変わるため
 * （上限＝別の時間帯なら取れる／受付外＝この時間はそもそも受け付けていない。
 * 空き待ちしても取れない）。
 */
export const isBlockedWindowError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { code?: string }).code === "GB006";
