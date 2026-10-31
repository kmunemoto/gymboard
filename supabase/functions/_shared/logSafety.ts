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
