// GymBoard 側: Salute からの種目マスタ取り込み + プラン定義の先行投入。
// - Salute の salute-export-exercises を共有シークレットで呼び出して exercises を取得
// - tenant_id を付与して GymBoard の exercises へ冪等に投入
// - exercise_id_map に Salute→GymBoard の対応を保存
// - tenant_plans に 4 プランを冪等に投入
// このフェーズではお客様アカウント・bookings・workouts は作成しない。
//
// 必要な Secrets:
//   - MIGRATION_SHARED_SECRET (Salute と同一)
//   - SALUTE_EXERCISES_URL (例: https://gvgrqaigffxtkvckjfur.supabase.co/functions/v1/salute-export-exercises)
//     未設定時は SALUTE_EXPORT_URL から "salute-export-counts" を "salute-export-exercises" に置換して使用

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeAdmin } from "../_shared/migrationAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

const PLANS = [
  { plan_name: "月4回", max_sessions: 4, price: 20000, sort_order: 1 },
  { plan_name: "月6回", max_sessions: 6, price: 28500, sort_order: 2 },
  { plan_name: "月8回", max_sessions: 8, price: 36000, sort_order: 3 },
  { plan_name: "月4回(30分)", max_sessions: 4, price: 10000, sort_order: 4 },
];

type SaluteExercise = {
  id: string;
  name: string;
  category: string | null;
  muscle_group: string | null;
  default_weight: number | null;
  default_reps: number | null;
  default_sets: number | null;
  notes: string | null;
  sort_order: number | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (!authorizeAdmin(req)) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    let SALUTE_EXERCISES_URL = Deno.env.get("SALUTE_EXERCISES_URL");
    if (!SALUTE_EXERCISES_URL) {
      const base = Deno.env.get("SALUTE_EXPORT_URL");
      if (base) SALUTE_EXERCISES_URL = base.replace("salute-export-counts", "salute-export-exercises");
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SHARED_SECRET || !SALUTE_EXERCISES_URL) {
      return json({ ok: false, error: "Missing MIGRATION_SHARED_SECRET or SALUTE_EXERCISES_URL" }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ===== 1. プラン投入 (冪等) =====
    const planResults: Array<{ plan_name: string; action: "created" | "exists"; id: string }> = [];
    const { data: existingPlans, error: planFetchErr } = await admin
      .from("tenant_plans")
      .select("id, plan_name")
      .eq("tenant_id", TENANT_ID);
    if (planFetchErr) throw new Error(`tenant_plans fetch: ${planFetchErr.message}`);
    const existingPlanByName = new Map((existingPlans ?? []).map((p) => [p.plan_name, p.id]));

    for (const p of PLANS) {
      const existingId = existingPlanByName.get(p.plan_name);
      if (existingId) {
        planResults.push({ plan_name: p.plan_name, action: "exists", id: existingId });
        continue;
      }
      const { data: ins, error: insErr } = await admin
        .from("tenant_plans")
        .insert({
          tenant_id: TENANT_ID,
          plan_name: p.plan_name,
          plan_type: "subscription",
          max_sessions: p.max_sessions,
          price: p.price,
          validity_days: 30,
          allow_overflow: true,
          sort_order: p.sort_order,
          is_active: true,
        })
        .select("id")
        .single();
      if (insErr) throw new Error(`tenant_plans insert (${p.plan_name}): ${insErr.message}`);
      planResults.push({ plan_name: p.plan_name, action: "created", id: ins!.id });
    }

    // ===== 2. Salute から exercises 取得 =====
    const upstream = await fetch(SALUTE_EXERCISES_URL, {
      method: "GET",
      headers: { "x-migration-secret": SHARED_SECRET, "Content-Type": "application/json" },
    });
    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      return json({ ok: false, step: "fetch_salute_exercises", upstream_status: upstream.status, body: upstreamText }, 502);
    }
    const upstreamJson = JSON.parse(upstreamText);
    const saluteExercises: SaluteExercise[] = upstreamJson?.exercises ?? upstreamJson?.data ?? upstreamJson;
    if (!Array.isArray(saluteExercises)) {
      return json({ ok: false, error: "Unexpected upstream shape", upstream: upstreamJson }, 500);
    }

    // ===== 3. GymBoard 既存 exercises を取得 (name で照合) =====
    const { data: existingEx, error: exFetchErr } = await admin
      .from("exercises")
      .select("id, name, tenant_id");
    if (exFetchErr) throw new Error(`exercises fetch: ${exFetchErr.message}`);
    const existingByName = new Map<string, string>();
    for (const e of existingEx ?? []) {
      // name はテーブル全体で UNIQUE。テナントを超えて重複させない。
      existingByName.set(e.name, e.id);
    }

    // ===== 4. exercise_id_map 既存を取得 (冪等) =====
    const { data: existingMap, error: mapFetchErr } = await admin
      .from("exercise_id_map")
      .select("salute_exercise_id, gymboard_exercise_id")
      .eq("tenant_id", TENANT_ID);
    if (mapFetchErr) throw new Error(`exercise_id_map fetch: ${mapFetchErr.message}`);
    const mapped = new Set((existingMap ?? []).map((m) => m.salute_exercise_id));

    let created = 0;
    let reused = 0;
    let mappedNew = 0;

    for (const se of saluteExercises) {
      let gymboardId = existingByName.get(se.name);
      if (!gymboardId) {
        const { data: ins, error: insErr } = await admin
          .from("exercises")
          .insert({
            tenant_id: TENANT_ID,
            name: se.name,
            category: se.category ?? "その他",
            muscle_group: se.muscle_group ?? "その他",
            default_weight: se.default_weight,
            default_reps: se.default_reps,
            default_sets: se.default_sets,
            notes: se.notes,
            sort_order: se.sort_order ?? 0,
          })
          .select("id")
          .single();
        if (insErr) throw new Error(`exercises insert (${se.name}): ${insErr.message}`);
        gymboardId = ins!.id;
        existingByName.set(se.name, gymboardId);
        created++;
      } else {
        reused++;
      }

      if (!mapped.has(se.id)) {
        const { error: mapInsErr } = await admin
          .from("exercise_id_map")
          .insert({
            tenant_id: TENANT_ID,
            salute_exercise_id: se.id,
            gymboard_exercise_id: gymboardId,
          });
        if (mapInsErr) throw new Error(`exercise_id_map insert (${se.name}): ${mapInsErr.message}`);
        mapped.add(se.id);
        mappedNew++;
      }
    }

    const { count: mapCount } = await admin
      .from("exercise_id_map")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      plans: planResults,
      exercises: {
        salute_total: saluteExercises.length,
        created,
        reused_existing: reused,
        map_inserted: mappedNew,
        map_total: mapCount ?? null,
      },
    }, 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
