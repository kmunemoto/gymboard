import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// OAuth 完了後の遷移先。
// Edge Function から HTML を返すと、この環境ではブラウザが text/plain 扱いで
// 生ソース表示＋文字化けになってしまう（line-login-callback が HTML ではなく
// リダイレクトを使っているのと同じ理由）。そのためアプリへ 302 リダイレクトする。
// 'app.gymboard.app' は DNS 未設定で存在しないドメインだったため、実際に生きている
// 本番ドメイン 'app.kyoto-salute.com' に修正済み（2026-07）。
const appUrl = "https://app.kyoto-salute.com";

function redirect(path: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${appUrl}${path}` } });
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
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return redirect("/?gcal_link=error");
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
      return redirect("/?gcal_link=error");
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
      return redirect("/?gcal_link=error");
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
      return redirect("/?gcal_link=error");
    }

    return redirect("/?gcal_link=success");
  } catch (e) {
    console.error("google-calendar-callback error:", e);
    return redirect("/?gcal_link=error");
  }
});
