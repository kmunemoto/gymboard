// 管理/移行/診断系 Edge Function 用の受信認可ヘルパー。
//
// 背景: これらの関数は service_role で動作し、データの削除・上書き・外部同期を行う。
// プラットフォームの verify_jwt は「公開 anon キー」でも通過するため認可にならない。
// そこで「service_role の Bearer トークン」または「x-migration-secret ヘッダ
// （MIGRATION_SHARED_SECRET と一致）」のいずれかを必須にする。
// どちらも無い/不一致なら未認可として拒否する。

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 認可できれば true。service_role Bearer か、正しい x-migration-secret を要求。
export function authorizeAdmin(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (serviceKey && token && constantTimeEq(token, serviceKey)) return true;

  const secret = Deno.env.get("MIGRATION_SHARED_SECRET") ?? "";
  const provided = req.headers.get("x-migration-secret") ?? "";
  if (secret && provided && constantTimeEq(provided, secret)) return true;

  return false;
}
