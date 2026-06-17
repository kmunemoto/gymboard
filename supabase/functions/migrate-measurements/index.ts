// GymBoard: Salute の user_measurements を移行する (冪等)。
// - Salute 側 salute-export-measurements を x-migration-secret で呼び出す
// - migration_user_map で salute_user_id → gymboard_user_id に変換
// - tenant_id = ceda19b0... 固定で user_measurements に UPSERT
// - (user_id, measured_date) で重複時は更新
//
// 必要 Secrets:
//   - MIGRATION_SHARED_SECRET
//   - SALUTE_MEASUREMENTS_URL (未設定なら SALUTE_EXPORT_URL から派生)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

type SaluteMeasurement = {
  user_id: string;
  measured_date: string;
  weight: number | null;
  body_fat: number | null;
  created_at?: string | null;
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    let SALUTE_MEASUREMENTS_URL = Deno.env.get("SALUTE_MEASUREMENTS_URL");
    if (!SALUTE_MEASUREMENTS_URL) {
      const base = Deno.env.get("SALUTE_EXPORT_URL");
      if (base) {
        SALUTE_MEASUREMENTS_URL = base
          .replace("salute-export-counts", "salute-export-measurements")
          .replace("salute-export-customers", "salute-export-measurements");
      }
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SHARED_SECRET || !SALUTE_MEASUREMENTS_URL) {
      return json({ ok: false, error: "Missing MIGRATION_SHARED_SECRET or SALUTE_MEASUREMENTS_URL/SALUTE_EXPORT_URL" }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Salute から全 user_measurements を取得
    const upstream = await fetch(SALUTE_MEASUREMENTS_URL, {
      method: "GET",
      headers: { "x-migration-secret": SHARED_SECRET, "Content-Type": "application/json" },
    });
    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      return json({ ok: false, step: "fetch_salute_measurements", status: upstream.status, body: upstreamText }, 502);
    }
    const upstreamJson = JSON.parse(upstreamText);
    const measurements: SaluteMeasurement[] =
      upstreamJson?.measurements ?? upstreamJson?.data ?? upstreamJson;
    if (!Array.isArray(measurements)) {
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

    // 3. 各レコードを UPSERT
    let inserted = 0;
    let updated = 0;
    let skipped_unmapped = 0;
    const errors: Array<{ salute_user_id: string; measured_date: string; error: string }> = [];

    for (const m of measurements) {
      const gymUserId = idMap.get(m.user_id);
      if (!gymUserId) {
        skipped_unmapped++;
        continue;
      }

      // 既存判定
      const { data: existing } = await admin
        .from("user_measurements")
        .select("id")
        .eq("user_id", gymUserId)
        .eq("measured_date", m.measured_date)
        .maybeSingle();

      const row = {
        user_id: gymUserId,
        tenant_id: TENANT_ID,
        measured_date: m.measured_date,
        weight: m.weight,
        body_fat: m.body_fat,
        ...(m.created_at ? { created_at: m.created_at } : {}),
      };

      const { error } = await admin
        .from("user_measurements")
        .upsert(row, { onConflict: "user_id,measured_date" });

      if (error) {
        errors.push({ salute_user_id: m.user_id, measured_date: m.measured_date, error: error.message });
        continue;
      }
      if (existing) updated++;
      else inserted++;
    }

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      total: measurements.length,
      inserted,
      updated,
      skipped_unmapped,
      errors,
    }, 200);
  } catch (e) {
    const err = e as { message?: string };
    return json({ ok: false, error: err.message ?? String(e) }, 500);
  }
});
