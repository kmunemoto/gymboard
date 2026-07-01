import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * OAuth コールバックの結果画面。
 * - モバイルでも確実に HTML として描画されるよう、DOCTYPE / charset / viewport を持つ
 *   完全なドキュメントを返す（簡易 HTML だとソースがそのまま表示されることがあるため）。
 * - opener があれば postMessage で結果を通知し、可能なら自動で閉じる。
 * - モバイルでは window.close() が効かないため、閉じられなくても分かるよう完了文言を表示する。
 */
function resultPage(success: boolean, title: string, message: string): Response {
  const color = success ? "#3b82f6" : "#ef4444";
  const bg = success ? "rgba(59,130,246,0.15)" : "rgba(239,68,68,0.15)";
  const iconPath = success
    ? `<polyline points="20 6 9 17 4 12"></polyline>`
    : `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Googleカレンダー連携</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
    background: #0b0b0f;
    color: #f5f5f7;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
  }
  .card { max-width: 340px; text-align: center; }
  .icon {
    width: 56px; height: 56px; margin: 0 auto 16px;
    border-radius: 9999px;
    display: flex; align-items: center; justify-content: center;
    background: ${bg}; color: ${color};
  }
  h1 { font-size: 18px; font-weight: 700; margin: 0 0 8px; }
  p { font-size: 14px; line-height: 1.6; color: #a1a1aa; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'google-calendar-result', success: ${success} }, '*');
      }
    } catch (e) {}
    setTimeout(function () { try { window.close(); } catch (e) {} }, 400);
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
    status: 200,
  });
}

/**
 * Look up an oauth_states row by nonce, verify it belongs to the expected provider,
 * is not expired, and not previously consumed. Marks the row as used atomically.
 * Returns the bound user_id, or null if invalid.
 */
async function consumeOauthState(
  supabase: ReturnType<typeof createClient>,
  nonce: string,
  provider: string,
): Promise<string | null> {
  // Try to parse uuid; reject malformed input early
  if (!/^[0-9a-fA-F-]{36}$/.test(nonce)) return null;

  const { data, error } = await supabase
    .from("oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("nonce", nonce)
    .eq("provider", provider)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();
  if (error) {
    console.error("consumeOauthState error:", error);
    return null;
  }
  return (data as any)?.user_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return resultPage(false, "認証に失敗しました", "お手数ですが、この画面を閉じてアプリからもう一度お試しください。");
  }

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify state via single-use nonce
    const userId = await consumeOauthState(supabase, state, "google_calendar");
    if (!userId) {
      console.warn("Invalid or expired google_calendar oauth state");
      return resultPage(false, "セッションが無効です", "お手数ですが、この画面を閉じてアプリからもう一度連携してください。");
    }

    const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      throw new Error("Token exchange failed");
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: dbError } = await supabase
      .from("google_calendar_tokens")
      .upsert(
        {
          user_id: userId,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt,
          calendar_id: "primary",
        },
        { onConflict: "user_id" },
      );

    if (dbError) {
      console.error("DB upsert error:", dbError);
      throw new Error("Failed to save tokens");
    }

    return resultPage(true, "Googleカレンダー連携が完了しました", "この画面を閉じて、アプリに戻ってください。");
  } catch (e) {
    console.error("google-calendar-callback error:", e);
    return resultPage(false, "エラーが発生しました", "お手数ですが、この画面を閉じてアプリからもう一度お試しください。");
  }
});
