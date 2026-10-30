/**
 * 「ご来店前のお願い」（2026-10-27）。
 *
 * 宗本さん「お客様にトレーニング前の１～２時間前にエネルギーになるものを摂取して
 * お越しくださいという意味の文章を伝えたい。そういうのを設定できる仕組みを考えて、作って」。
 * 出す場所は「アプリ内だけ」と確認済み（通知・メールには入れない。メールには店ごとの一文欄
 * `booking_email_note` / `reminder_email_note` が既にある）。
 *
 * - 店が自由に書く文（`tenants.pre_visit_note`）。食事に限らない
 * - 出す場所は会員の2か所: 予約完了画面・ホームの次回の予約（src/components/booking/PreVisitNote.tsx）。
 *   🔴 体験予約の完了画面には出さない（2026-10-30 宗本さん「体験には出さないでください」）
 * - 🔴 既定は NULL＝何も出さない。上流が文言を代弁しない（例文は設定画面のボタンで入れるだけ）
 */

/** 長さの上限。DB の CHECK（20261027010000_pre_visit_note.sql）と同じ値 */
export const PRE_VISIT_NOTE_MAX = 300;

/** 出す文。空白だけ・未設定は null（何も出さない）。前後の空白は落とす */
export const normalizePreVisitNote = (value: string | null | undefined): string | null => {
  const s = (value ?? "").trim();
  return s ? s.slice(0, PRE_VISIT_NOTE_MAX) : null;
};
