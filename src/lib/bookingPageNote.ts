/**
 * 「予約画面のご案内」（2026-11-14）。
 *
 * 宗本さん「予約画面の一番上にも出せるようにして」。伝えたいのは「次回分のご予約も前もって取れる・
 * お支払いは毎回1回目のトレーニングの日」のような、予約を取る前に読んでほしいこと。
 *
 * - 店が自由に書く文（`tenants.booking_page_note`）
 * - 出す場所は会員の予約画面（日時を選ぶ画面）のいちばん上だけ（src/components/booking/BookingPageNote.tsx）。
 *   体験予約・ドロップイン（未ログインの公開ページ）には出さない
 * - 🔴 既定は NULL＝何も出さない。上流が文言を代弁しない（例は入力欄の薄い文字だけ）
 * - 予約完了の画面とホームの「次回の予約」に出すのは別の欄「ご来店前のお願い」（src/lib/preVisitNote.ts）
 */

/** 長さの上限。DB の CHECK（20261114010000_booking_page_note.sql）と同じ値 */
export const BOOKING_PAGE_NOTE_MAX = 300;

/** 出す文。空白だけ・未設定は null（何も出さない）。前後の空白は落とす */
export const normalizeBookingPageNote = (value: string | null | undefined): string | null => {
  const s = (value ?? "").trim();
  return s ? s.slice(0, BOOKING_PAGE_NOTE_MAX) : null;
};
