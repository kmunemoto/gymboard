import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const caller = await verifyCaller(req);
    if (!caller || !caller.userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const channelId = Deno.env.get("LINE_LOGIN_CHANNEL_ID");
    if (!channelId) {
      return new Response(JSON.stringify({ error: "LINE_LOGIN_CHANNEL_ID not set" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: stateRow, error: stateErr } = await supabase
      .from("oauth_states")
      .insert({ user_id: caller.userId, provider: "line_login" })
      .select("nonce")
      .single();
    if (stateErr || !stateRow?.nonce) {
      console.error("oauth_states insert failed:", stateErr);
      return new Response(JSON.stringify({ error: "Failed to create state" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const redirectUri = `${supabaseUrl}/functions/v1/line-login-callback`;
    const authUrl =
      `https://access.line.me/oauth2/v2.1/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(channelId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${stateRow.nonce}` +
      `&scope=${encodeURIComponent("profile openid")}`;

    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("line-auth-url error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
