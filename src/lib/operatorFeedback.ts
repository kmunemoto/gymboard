/**
 * 運営への要望（operator_feedback）のクライアント側ロジック。
 *
 * 上限 2000 文字は DB の CHECK（migrations/20260814010000）と同じ値。
 * ここで先に弾くのは、DB エラーを「送信に失敗しました」としか言えないため
 * （CHECK 違反の Postgres エラーを利用者に見せても意味が分からない）。
 */

/** DB の CHECK と一致させること（char_length(btrim(body)) BETWEEN 1 AND 2000） */
export const FEEDBACK_MAX_LEN = 2000;

/** 送信できる本文か。空白だけは不可、trim 後 2000 文字まで。 */
export const canSendFeedback = (body: string): boolean => {
  const trimmed = body.trim();
  return trimmed.length >= 1 && trimmed.length <= FEEDBACK_MAX_LEN;
};
