import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // trainer user_id
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return new Response(
      `<html><body><script>window.opener?.postMessage({type:'google-calendar-result',success:false},'*');window.close();</script><p>認証に失敗しました。このウィンドウを閉じてください。</p></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 },
    );
  }

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-callback`;

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("Token exchange failed:", tokenData);
      throw new Error("Token exchange failed");
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Upsert tokens
    const { error: dbError } = await supabase
      .from("google_calendar_tokens")
      .upsert(
        {
          user_id: state,
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

    return new Response(
      `<html><body><script>window.opener?.postMessage({type:'google-calendar-result',success:true},'*');window.close();</script><p>Googleカレンダー連携が完了しました！このウィンドウを閉じてください。</p></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 },
    );
  } catch (e) {
    console.error("google-calendar-callback error:", e);
    return new Response(
      `<html><body><script>window.opener?.postMessage({type:'google-calendar-result',success:false},'*');window.close();</script><p>エラーが発生しました。このウィンドウを閉じてください。</p></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 },
    );
  }
});
