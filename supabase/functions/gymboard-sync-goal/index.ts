// GymBoard 側: Salute の training_goal 変更をリアルタイム受信し、
// テナント ceda19b0-... の該当お客様 profiles.training_goal を更新する。
// - x-migration-secret ヘッダで認証 (MIGRATION_SHARED_SECRET と一致必須)
// - user_id は migration_user_map で salute_user_id → gymboard_user_id 変換
// - 未マップユーザーは skipped_unmapped
// - エラーも 200 + ok:false で返す (呼び出し元 fire-and-forget)
// - service_role で実行 (RLS 回避)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-migration-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Payload = {
  salute_user_id?: string;
  training_goal?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SHARED_SECRET) {
      return json({ ok: false, error: "Server misconfigured: MIGRATION_SHARED_SECRET missing" }, 500);
    }

    const provided = req.headers.get("x-migration-secret") ?? "";
    if (provided !== SHARED_SECRET) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const saluteUserId = body.salute_user_id;
    if (!saluteUserId || typeof saluteUserId !== "string") {
      return json({ ok: false, error: "salute_user_id is required and must be a string" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: mapped, error: mapErr } = await admin
      .from("migration_user_map")
      .select("gymboard_user_id")
      .eq("tenant_id", TENANT_ID)
      .eq("salute_user_id", saluteUserId)
      .maybeSingle();

    if (mapErr) {
      return json({ ok: false, error: `user map lookup failed: ${mapErr.message}` }, 200);
    }

    if (!mapped?.gymboard_user_id) {
      return json({ ok: true, action: "skipped_unmapped", salute_user_id: saluteUserId }, 200);
    }

    const gymboardUserId = mapped.gymboard_user_id as string;

    const { error: updErr } = await admin
      .from("profiles")
      .update({ training_goal: body.training_goal ?? null })
      .eq("id", gymboardUserId)
      .eq("tenant_id", TENANT_ID);

    if (updErr) {
      return json({ ok: false, error: `update failed: ${updErr.message}`, code: updErr.code }, 200);
    }

    return json({ ok: true, action: "updated", gymboard_user_id: gymboardUserId }, 200);
  } catch (e) {
    const err = e as { message?: string };
    return json({ ok: false, error: err.message ?? String(e) }, 200);
  }
});
