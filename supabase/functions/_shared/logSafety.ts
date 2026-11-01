// ログに個人情報・秘密を出さないための小道具（2026-10-31・auth-email-hook-1/2）。
// Deno（Edge Function）からも vitest からも import できるよう、import を持たない純粋な関数だけを置く。
//
// Edge Function のログは、Lovable Cloud / Supabase の関係者・Lovable のエージェントが見られ、
// 貼り付けやスクリーンショットで外にも出る。メールアドレスは伏せ字にし、トークン入りの URL は出さない。

/** "taro@example.com" → "t***@example.com"。メールアドレスでなければ "***" */
export function maskEmail(email: unknown): string {
  if (typeof email !== "string") return "***";
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

// ログインの鍵（token_hash・access_token・refresh_token）を含む値。招待メールの inviteUrl
// （/reset-password?token_hash=…&type=recovery）がこれに当たる。
// ⚠️ 体験予約の取り消しリンク（trial-cancel?token=…）はログインの鍵ではなく、再送で描き直すので伏せない
const LOGIN_TOKEN_IN_VALUE = /(?:token_hash|access_token|refresh_token)=/i;
export const REDACTED_FOR_LOG = "[redacted]";

/**
 * 送信履歴（email_send_log.template_data）に残す前に、ログインの鍵が入った値を伏せる
 * （2026-11-01 点検 invite-link-in-log-1）。
 *
 * 🔴 送信履歴はジムのスタッフ（インストラクターを含む）が API で全列を読める。招待メールの inviteUrl
 *    （token_hash 入り）がそのまま残っていて、お客様が開く前にスタッフが開けば、そのお客様としてログインできた。
 *    メールの本文には元の値を使い、履歴にだけ伏せた値を残す。伏せた値では描き直せないので、
 *    再送（resend-email）は招待を断り、カードの「招待する」からやり直してもらう。
 */
export function redactTemplateDataForLog<T>(data: T): T {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    out[key] = typeof value === "string" && LOGIN_TOKEN_IN_VALUE.test(value) ? REDACTED_FOR_LOG : value;
  }
  return out as T;
}
