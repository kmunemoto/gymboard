// Edge Function から別の Edge Function を service_role として呼ぶ（2026-11-10）。
//
// 🔴 `supabase.functions.invoke()` を使わないこと（少なくとも `npm:@supabase/supabase-js@2` では）。
//
// 本番（Lovable Cloud）の SUPABASE_SERVICE_ROLE_KEY は新しい形式の鍵（`sb_secret_…`。JWT ではない）。
// 新しい supabase-js（2.119 で確かめた）は、この形式の鍵を Authorization に載せず apikey だけで送る。
// 呼ばれる側（send-transactional-email など）は Authorization の Bearer が service_role の鍵と同じかで
// 「サーバー同士の呼び出し」を見分けるので、鍵が無い呼び出しは 401 で断られ、**送信履歴にも1行も残らない**。
//
// 実際に起きていたこと（2026-11-10 に本番で確かめた）:
//   - 体験の前日リマインド（send-trial-reminders）が、毎晩動いているのに一度も送られていなかった
//   - 送信履歴の「再送」（resend-email）・取り込んだお客様への招待（invite-customer）・
//     古いアプリから来た店宛てメールの先生への写し（send-transactional-email）も同じ経路で失敗していた
// 古い supabase-js（esm.sh の 2.49.x）は鍵の形式に関係なく Bearer を付けるので、そちらを使う関数は動いていた。
//
// ここでは fetch で Authorization と apikey を自分で付ける（trial-book の invokeFn と同じ形）。
// import なし（vitest からもそのまま読める）。

export interface ServiceInvokeResult {
  /** 応答の本文（JSON なら解析したもの、そうでなければ文字列。届かなければ null） */
  data: unknown;
  /** 失敗の内容（2xx なら null） */
  error: string | null;
  /** HTTP の状態（届かなければ 0） */
  status: number;
}

/** 呼ぶ先が固まっても、呼んだ側の応答を人質に取らない */
const DEFAULT_TIMEOUT_MS = 20_000;

export async function invokeAsService(
  name: string,
  body: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<ServiceInvokeResult> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return { data: null, error: "missing_env", status: 0 };
  try {
    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // JSON でない応答はそのまま
    }
    return { data, error: res.ok ? null : `http_${res.status}`, status: res.status };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e), status: 0 };
  }
}
