/**
 * 予約確認メール・リマインドメールに足す、店ごとの一文
 * （`tenants.booking_email_note` / `tenants.reminder_email_note`）。
 *
 * ## テンプレート全体を編集させない
 *
 * 本文まるごとを店に編集させると、日時やキャンセルリンクといった**必須の情報を
 * 消せてしまう**し、HTML を書けてしまう。「決まった位置に1ブロック足せる」だけに
 * すれば、実務上の要望（案内を1〜2行足したい）はほぼ満たせて危険が消える。
 *
 * ## 🔴 送信時のエンティティ化に必ず通す
 *
 * 店の自由入力がメール本文に入る初めての経路。
 * `supabase/functions/_shared/email-encoding.ts` の `makeEmailHtmlAsciiSafe` が
 * 送信直前に全テキストノードを `&#N;` にするので、**テンプレート側は素の文字列を
 * `<Text>` に渡すだけでよい**（React がエスケープし、その後 ASCII 化される）。
 * `dangerouslySetInnerHTML` を使ってはいけない（2026-08-18 の文字化けの再来になる）。
 */

/**
 * 1本あたりの最大文字数。**DB の CHECK 制約と同じ値にすること**
 * （`20260820040000_tenant_email_notes.sql`。テストが一致を見張る）。
 */
export const EMAIL_NOTE_MAX_LENGTH = 500;

/**
 * 保存用に整える。空白だけなら `null`（＝ブロックごと出さない）。
 *
 * 既定文は持たない。何を案内するかは店ごとに違うので、上流が代弁しない
 * （`cancel_policy_body` と同じ方針）。
 */
export const normalizeEmailNote = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, EMAIL_NOTE_MAX_LENGTH);
};
