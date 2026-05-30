// Promotes the calling user to the trainer role for the self-service signup flow.
//
// Security model (self-service):
//   1. Caller must present a valid user JWT (verifyCaller) — the role is only
//      ever assigned to the authenticated caller themselves.
//   2. The caller's email must be confirmed (`email_confirmed_at` set). This
//      ensures the account is bound to a reachable, real email address before
//      it gains trainer (tenant-owner) privileges.
//
// Tenant isolation guarantees (enforced elsewhere via RLS) ensure that a new
// trainer can only create / access their own tenant's data, so open self-signup
// does not expose other gyms' information.
//
// The legacy TRAINER_SIGNUP_CODE secret is no longer required. It is kept
// unused so that we can re-introduce gating in the future without a migration.
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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Require a confirmed email before granting trainer privileges.
    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(caller.userId);
    if (userErr || !userData?.user) {
      console.error("Failed to load user for trainer promotion", userErr);
      return new Response(JSON.stringify({ error: "ユーザー情報を取得できませんでした。" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!userData.user.email_confirmed_at) {
      return new Response(JSON.stringify({
        error: "メールアドレスの確認が完了していません。確認メール内のリンクをクリックしてからお試しください。",
        code: "email_not_confirmed",
      }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
