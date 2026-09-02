/**
 * `get_tenant_booked_slots`（埋まっている枠を返す RPC）の戻りを、画面が使う形に直す。
 *
 * この RPC は SECURITY DEFINER で、RLS に関係なく**そのジムの全予約**を返す
 * （自分の予約しか見えないと、他のお客様で埋まっている枠が「空き」に見えてしまう）。
 * 中身は誰の予約かではなく「いつからいつまで塞がっているか」だけ。
 *
 * 🔴 `end_booking_date` は DB 側で既に「開始＋1枠＋オプション＋間」で計算済み。
 * 画面でここに更に間を足すと二重計上になり、1枠ぶん余計に満枠化する。
 *
 * 🔴 同日キャンセル消化（`SAME_DAY_FORFEIT_STATUS`）は**除外しない**。
 * その枠は再販できない前提なので、カレンダー上は引き続き「埋まっている」枠として扱う
 * （`mem/features/booking-cancellation.md`）。除外するのは通常のキャンセルだけ。
 */
import { format } from "date-fns";
import { toJSTDate } from "@/lib/timezone";

/** 画面が持つ「埋まっている枠」1件。 */
export interface BookedSlot {
  /** yyyy-MM-dd */
  date: string;
  /** HH:MM */
  startTime: string;
  /** HH:MM。**すでに 1枠＋オプション＋間 で計算済み**（足し直さない）。 */
  endTime: string;
  /** 店の休憩・清掃など。空きベッド数に関係なく店全体を塞ぐ。 */
  isBlock: boolean;
  staffUserId: string | null;
}

/** RPC の1行（必要な列だけ）。 */
export interface BookedSlotRow {
  booking_date: string;
  end_booking_date: string;
  status: string;
  staff_user_id?: string | null;
}

const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const toBookedSlots = (rows: ReadonlyArray<BookedSlotRow> | null | undefined): BookedSlot[] =>
  (rows ?? [])
    .filter((r) => r.status !== "キャンセル済み")
    .map((r) => {
      const start = toJSTDate(r.booking_date);
      const end = toJSTDate(r.end_booking_date);
      return {
        date: format(start, "yyyy-MM-dd"),
        startTime: hhmm(start),
        endTime: hhmm(end),
        isBlock: r.status === "ブロック済み",
        staffUserId: r.staff_user_id ?? null,
      };
    });
