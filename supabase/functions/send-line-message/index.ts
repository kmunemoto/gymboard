const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const LINE_API = "https://api.line.me/v2/bot/message/push";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "LINE_CHANNEL_ACCESS_TOKEN not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id, line_user_id, to, message } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // If to === "trainer", send to all trainers with LINE linked
    if (to === "trainer") {
      const { data: trainerIds } = await supabase.rpc("get_trainer_ids");
      if (!trainerIds || trainerIds.length === 0) {
        return new Response(JSON.stringify({ skipped: true, reason: "no trainers found" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const results = [];
      for (const t of trainerIds) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("line_user_id")
          .eq("user_id", t.user_id)
          .maybeSingle();

        const tid = profile?.line_user_id;
        if (!tid) {
          results.push({ user_id: t.user_id, skipped: true, reason: "no LINE linked" });
          continue;
        }

        const res = await fetch(LINE_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            to: tid,
            messages: [{ type: "text", text: message }],
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          console.error("LINE API error for trainer:", t.user_id, err);
          results.push({ user_id: t.user_id, error: err });
        } else {
          results.push({ user_id: t.user_id, success: true });
        }
      }

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Single user mode
    let targetLineId = line_user_id;
    if (!targetLineId && user_id) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("line_user_id")
        .eq("user_id", user_id)
        .maybeSingle();

      targetLineId = profile?.line_user_id;
    }

    if (!targetLineId) {
      return new Response(JSON.stringify({ skipped: true, reason: "no LINE linked" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(LINE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: targetLineId,
        messages: [{ type: "text", text: message }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("LINE API error:", err);
      return new Response(JSON.stringify({ error: err }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-line-message error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
