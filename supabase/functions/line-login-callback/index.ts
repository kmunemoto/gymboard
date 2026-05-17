import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const appUrl = "https://app.kyoto-salute.com";

  if (req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error || !code || !state) {
      return redirect(`${appUrl}/?line_link=error`);
    }

    try {
      const channelId = Deno.env.get("LINE_LOGIN_CHANNEL_ID")!;
      const channelSecret = Deno.env.get("LINE_CHANNEL_SECRET")!;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `${supabaseUrl}/functions/v1/line-login-callback`,
          client_id: channelId,
          client_secret: channelSecret,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("LINE token error:", err);
        return redirect(`${appUrl}/?line_link=error`);
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      const profileRes = await fetch("https://api.line.me/v2/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!profileRes.ok) {
        return redirect(`${appUrl}/?line_link=error`);
      }

      const lineProfile = await profileRes.json();
      const lineUserId = lineProfile.userId;

      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ line_user_id: lineUserId })
        .eq("user_id", state);

      if (updateError) {
        console.error("Profile update error:", updateError);
        return redirect(`${appUrl}/?line_link=error`);
      }

      return redirect(`${appUrl}/?line_link=success`);
    } catch (e) {
      console.error("line-login-callback error:", e);
      return redirect(`${appUrl}/?line_link=error`);
    }
  }

  return new Response("Method not allowed", { status: 405 });
});
