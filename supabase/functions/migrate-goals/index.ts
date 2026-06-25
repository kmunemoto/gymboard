// GymBoard: Salute の training_goal を移行する (冪等)。
// - Salute 側 salute-export-goals を x-migration-secret で呼び出す
// - migration_user_map で salute_user_id → gymboard_user_id に変換
// - profiles.training_goal を UPDATE する
//
// 必要 Secrets:
//   - MIGRATION_SHARED_SECRET
//   - SALUTE_GOALS_URL (未設定なら SALUTE_EXPORT_URL から派生)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { authorizeAdmin } from "../_shared/migrationAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

type SaluteGoal = {
  user_id: string;
  training_goal: string | null;
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizeAdmin(req)) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    let SALUTE_GOALS_URL = Deno.env.get("SALUTE_GOALS_URL");
    if (!SALUTE_GOALS_URL) {
      const base = Deno.env.get("SALUTE_EXPORT_URL");
      if (base) {
        SALUTE_GOALS_URL = base
          .replace("salute-export-measurements", "salute-export-goals")
          .replace("salute-export-counts", "salute-export-goals")
          .replace("salute-export-customers", "salute-export-goals");
      }
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SHARED_SECRET || !SALUTE_GOALS_URL) {
      return json({ ok: false, error: "Missing MIGRATION_SHARED_SECRET or SALUTE_GOALS_URL/SALUTE_EXPORT_URL" }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Salute から training_goal を取得
    const upstream = await fetch(SALUTE_GOALS_URL, {
      method: "GET",
      headers: { "x-migration-secret": SHARED_SECRET, "Content-Type": "application/json" },
    });
    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      return json({ ok: false, step: "fetch_salute_goals", status: upstream.status, body: upstreamText }, 502);
    }
    const upstreamJson = JSON.parse(upstreamText);
    const goals: SaluteGoal[] =
      upstreamJson?.goals ?? upstreamJson?.data ?? upstreamJson;
    if (!Array.isArray(goals)) {
      return json({ ok: false, error: "Unexpected upstream shape", upstream: upstreamJson }, 500);
    }

    // 2. migration_user_map を一括ロード
    const { data: userMap, error: mapErr } = await admin
      .from("migration_user_map")
      .select("salute_user_id, gymboard_user_id")
      .eq("tenant_id", TENANT_ID);
    if (mapErr) {
      return json({ ok: false, step: "load_user_map", error: mapErr.message }, 500);
    }
    const idMap = new Map<string, string>(
      (userMap ?? []).map((m) => [m.salute_user_id, m.gymboard_user_id]),
    );

    // 3. profiles.training_goal を UPDATE
    let updated = 0;
    let skipped_unmapped = 0;
    const errors: Array<{ salute_user_id: string; error: string }> = [];

    for (const g of goals) {
      const gymUserId = idMap.get(g.user_id);
      if (!gymUserId) {
        skipped_unmapped++;
        continue;
      }
      const trimmed = (g.training_goal ?? "").trim();
      const { error } = await admin
        .from("profiles")
        .update({ training_goal: trimmed || null })
        .eq("user_id", gymUserId);
      if (error) {
        errors.push({ salute_user_id: g.user_id, error: error.message });
        continue;
      }
      updated++;
    }

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      total: goals.length,
      updated,
      skipped_unmapped,
      errors,
    }, 200);
  } catch (e) {
    const err = e as { message?: string };
    return json({ ok: false, error: err.message ?? String(e) }, 500);
  }
});
