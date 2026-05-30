// Securely promotes the calling user to the trainer role.
// Replaces the previously-public `assign_trainer_role` RPC that allowed any
// customer to self-promote. Requires:
//   1. A valid user JWT (the caller is the user being promoted).
//   2. A `signup_code` body field that matches the TRAINER_SIGNUP_CODE secret.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const caller = await verifyCaller(req);
    if (!caller?.userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null) as { signup_code?: string } | null;
    const supplied = typeof body?.signup_code === "string" ? body.signup_code.trim() : "";
    const expected = (Deno.env.get("TRAINER_SIGNUP_CODE") || "").trim();

    if (!expected) {
      console.error("TRAINER_SIGNUP_CODE secret is not configured");
      return new Response(JSON.stringify({ error: "トレーナー登録が無効です。管理者にお問い合わせください。" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!supplied || supplied !== expected) {
      return new Response(JSON.stringify({ error: "招待コードが正しくありません。" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error } = await admin
      .from("user_roles")
      .upsert({ user_id: caller.userId, role: "trainer" }, { onConflict: "user_id,role", ignoreDuplicates: true });
    if (error) {
      console.error("Failed to assign trainer role", error);
      return new Response(JSON.stringify({ error: "ロール付与に失敗しました。" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("signup-trainer error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
