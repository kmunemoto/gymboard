// GymBoard 側: Salute からお客様データを試験移行する関数 (冪等強化版)。
// - 各お客様の冒頭で migration_user_map を salute_user_id と email の両方でチェック
// - bookings/workouts は対象 user_id の既存件数が 0 のときだけ投入 (二重投入防止)
// - migration_user_map の INSERT は ON CONFLICT DO NOTHING (重複キーでエラーにしない)
// - 1人のエラーで他のお客様を止めない
// - パスワードは設定しない (リセット方式)
//
// 必要 Secrets:
//   - MIGRATION_SHARED_SECRET
//   - SALUTE_CUSTOMERS_URL (未設定なら SALUTE_EXPORT_URL から派生)
//
// Body: { "limit": 2 }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

type SaluteProfile = {
  display_name: string | null;
  plan: string | null;
  paid_this_month: boolean | null;
  trial_completed: boolean | null;
  cycle_start_date: string | null;
  show_usage_period: boolean | null;
};

type SaluteBooking = {
  booking_date: string;
  booking_type: string | null;
  status: string | null;
  google_event_id: string | null;
  created_at: string | null;
};

type SaluteWorkout = {
  salute_exercise_id: string | null;
  exercise_id?: string | null;
  workout_date: string;
  weight: number | null;
  reps: number | null;
  sets: unknown;
  notes: string | null;
  created_at: string | null;
};

type SaluteCustomer = {
  user_id: string;
  email: string;
  profile: SaluteProfile | null;
  bookings: SaluteBooking[];
  workouts: SaluteWorkout[];
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeBookingType(t: string | null): string | null {
  if (!t) return t;
  if (t === "月8回プラン") return "月8回";
  return t;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    let SALUTE_CUSTOMERS_URL = Deno.env.get("SALUTE_CUSTOMERS_URL");
    if (!SALUTE_CUSTOMERS_URL) {
      const base = Deno.env.get("SALUTE_EXPORT_URL");
      if (base) SALUTE_CUSTOMERS_URL = base.replace("salute-export-counts", "salute-export-customers");
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SHARED_SECRET || !SALUTE_CUSTOMERS_URL) {
      return json({ ok: false, error: "Missing MIGRATION_SHARED_SECRET or SALUTE_CUSTOMERS_URL" }, 500);
    }

    let body: { limit?: number; batch_size?: number } = {};
    try { body = await req.json(); } catch { /* default */ }
    // Salute 全員を取得するため limit はデフォルト 500
    const limit = Math.max(1, Math.min(500, Number(body.limit ?? 500)));
    // 1回の呼び出しで処理する最大人数
    const batchSize = Math.max(1, Math.min(50, Number(body.batch_size ?? 5)));

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Salute から取得
    const url = `${SALUTE_CUSTOMERS_URL}?limit=${limit}`;
    const upstream = await fetch(url, {
      method: "GET",
      headers: { "x-migration-secret": SHARED_SECRET, "Content-Type": "application/json" },
    });
    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      return json({ ok: false, step: "fetch_salute_customers", status: upstream.status, body: upstreamText }, 502);
    }
    const upstreamJson = JSON.parse(upstreamText);
    const customers: SaluteCustomer[] =
      upstreamJson?.customers ?? upstreamJson?.data ?? upstreamJson;
    if (!Array.isArray(customers)) {
      return json({ ok: false, error: "Unexpected upstream shape", upstream: upstreamJson }, 500);
    }

    // 2. exercise_id_map / tenant_plans / migration_user_map を一括ロード
    const { data: exMap } = await admin
      .from("exercise_id_map")
      .select("salute_exercise_id, gymboard_exercise_id")
      .eq("tenant_id", TENANT_ID);
    const exMapById = new Map<string, string>(
      (exMap ?? []).map((r) => [r.salute_exercise_id, r.gymboard_exercise_id]),
    );

    const { data: plans } = await admin
      .from("tenant_plans")
      .select("id, plan_name")
      .eq("tenant_id", TENANT_ID);
    const planIdByName = new Map<string, string>(
      (plans ?? []).map((p) => [p.plan_name, p.id]),
    );

    const { data: existingMap } = await admin
      .from("migration_user_map")
      .select("salute_user_id, gymboard_user_id, email")
      .eq("tenant_id", TENANT_ID);
    const mappedBySalute = new Map<string, { gymboard_user_id: string; email: string }>(
      (existingMap ?? []).map((m) => [m.salute_user_id, { gymboard_user_id: m.gymboard_user_id, email: m.email }]),
    );
    const mappedByEmail = new Map<string, { gymboard_user_id: string; salute_user_id: string }>(
      (existingMap ?? []).map((m) => [m.email.toLowerCase(), { gymboard_user_id: m.gymboard_user_id, salute_user_id: m.salute_user_id }]),
    );

    const results: Array<Record<string, unknown>> = [];
    let createdAuthUsers = 0;
    let reusedAuthUsers = 0;
    let skippedAlreadyMigrated = 0;

    for (const c of customers) {
      const log: Record<string, unknown> = { salute_user_id: c.user_id, email: c.email };
      try {
        // 冒頭スキップ判定 (salute_user_id または email で既存)
        const byId = mappedBySalute.get(c.user_id);
        const byEmail = mappedByEmail.get(c.email.toLowerCase());
        if (byId || byEmail) {
          skippedAlreadyMigrated++;
          log.status = "skipped_already_migrated";
          log.gymboard_user_id = byId?.gymboard_user_id ?? byEmail?.gymboard_user_id;
          log.matched_by = byId ? "salute_user_id" : "email";
          results.push(log);
          continue;
        }

        // (1) auth.users 作成 or 既存取得
        let gymboardUserId: string | null = null;
        const created = await admin.auth.admin.createUser({
          email: c.email,
          email_confirm: true,
          user_metadata: { migrated_from_salute: true, salute_user_id: c.user_id },
        });
        if (created.error) {
          const lookup = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
          const found = lookup.data?.users?.find((u) => (u.email ?? "").toLowerCase() === c.email.toLowerCase());
          if (!found) {
            log.status = "error";
            log.step = "auth_create";
            log.error = created.error.message;
            results.push(log);
            continue;
          }
          gymboardUserId = found.id;
          reusedAuthUsers++;
          log.auth = "reused_existing";
        } else {
          gymboardUserId = created.data.user!.id;
          createdAuthUsers++;
          log.auth = "created";
        }

        const p = c.profile ?? {} as SaluteProfile;

        // (2) profiles upsert
        const { error: profErr } = await admin
          .from("profiles")
          .upsert({
            user_id: gymboardUserId,
            display_name: p.display_name ?? null,
            plan: p.plan ?? null,
            paid_this_month: p.paid_this_month ?? false,
            trial_completed: p.trial_completed ?? false,
            cycle_start_date: p.cycle_start_date ?? null,
            show_usage_period: p.show_usage_period ?? true,
          }, { onConflict: "user_id" });
        if (profErr) throw new Error(`profiles: ${profErr.message}`);

        // (3) user_roles upsert
        const { error: roleErr } = await admin
          .from("user_roles")
          .upsert({ user_id: gymboardUserId, role: "customer" }, { onConflict: "user_id,role" });
        if (roleErr) throw new Error(`user_roles: ${roleErr.message}`);

        // (4) tenant_members upsert
        const planId = p.plan ? (planIdByName.get(p.plan) ?? null) : null;
        const { error: tmErr } = await admin
          .from("tenant_members")
          .upsert({
            tenant_id: TENANT_ID,
            user_id: gymboardUserId,
            role: "customer",
            display_name: p.display_name ?? null,
            cycle_start_date: p.cycle_start_date ?? null,
            plan_id: planId,
            status: "active",
          }, { onConflict: "tenant_id,user_id" });
        if (tmErr) throw new Error(`tenant_members: ${tmErr.message}`);
        log.plan_id = planId;
        log.plan_name = p.plan ?? null;

        // (5) bookings: 既存件数 0 のときだけ投入
        const { count: existingBookings } = await admin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("user_id", gymboardUserId);
        let bookingsInserted = 0;
        const bookingErrors: string[] = [];
        if ((existingBookings ?? 0) > 0) {
          log.bookings_skipped_existing = existingBookings;
        } else {
          for (const b of (c.bookings ?? [])) {
            const { error } = await admin
              .from("bookings")
              .insert({
                user_id: gymboardUserId,
                tenant_id: TENANT_ID,
                booking_date: b.booking_date,
                booking_type: normalizeBookingType(b.booking_type),
                status: b.status,
                google_event_id: b.google_event_id,
                created_at: b.created_at ?? undefined,
              });
            if (error) bookingErrors.push(`${b.booking_date}: ${error.message}`);
            else bookingsInserted++;
          }
        }
        log.bookings_total = (c.bookings ?? []).length;
        log.bookings_inserted = bookingsInserted;
        log.bookings_errors = bookingErrors;

        // (6) workouts: 既存件数 0 のときだけ投入
        const { count: existingWorkouts } = await admin
          .from("workouts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", gymboardUserId);
        let workoutsInserted = 0;
        let workoutsSkippedNoExercise = 0;
        const workoutErrors: string[] = [];
        if ((existingWorkouts ?? 0) > 0) {
          log.workouts_skipped_existing = existingWorkouts;
        } else {
          for (const w of (c.workouts ?? [])) {
            const salId = w.salute_exercise_id ?? w.exercise_id ?? null;
            const gymEx = salId ? exMapById.get(salId) : null;
            if (!gymEx) { workoutsSkippedNoExercise++; continue; }
            const { error } = await admin
              .from("workouts")
              .insert({
                user_id: gymboardUserId,
                tenant_id: TENANT_ID,
                exercise_id: gymEx,
                workout_date: w.workout_date,
                weight: w.weight,
                reps: w.reps,
                sets: w.sets ?? null,
                notes: w.notes,
                created_at: w.created_at ?? undefined,
              });
            if (error) workoutErrors.push(`${w.workout_date}: ${error.message}`);
            else workoutsInserted++;
          }
        }
        log.workouts_total = (c.workouts ?? []).length;
        log.workouts_inserted = workoutsInserted;
        log.workouts_skipped_no_exercise = workoutsSkippedNoExercise;
        log.workouts_errors = workoutErrors;

        // (7) migration_user_map upsert (DO NOTHING)
        const { error: mapErr } = await admin
          .from("migration_user_map")
          .upsert({
            tenant_id: TENANT_ID,
            salute_user_id: c.user_id,
            gymboard_user_id: gymboardUserId,
            email: c.email,
          }, { onConflict: "tenant_id,salute_user_id", ignoreDuplicates: true });
        if (mapErr) throw new Error(`migration_user_map: ${mapErr.message}`);

        // ローカルキャッシュも更新 (同一実行内の二重処理防止)
        mappedBySalute.set(c.user_id, { gymboard_user_id: gymboardUserId, email: c.email });
        mappedByEmail.set(c.email.toLowerCase(), { gymboard_user_id: gymboardUserId, salute_user_id: c.user_id });

        log.status = "ok";
        log.gymboard_user_id = gymboardUserId;
        results.push(log);
      } catch (e) {
        log.status = "error";
        log.error = e instanceof Error ? e.message : String(e);
        results.push(log);
      }
    }

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      limit,
      customers_processed: customers.length,
      auth_created: createdAuthUsers,
      auth_reused: reusedAuthUsers,
      skipped_already_migrated: skippedAlreadyMigrated,
      results,
    }, 200);
  } catch (e) {
    const err = e as { message?: string; details?: string; hint?: string; code?: string };
    return json({
      ok: false,
      error: err.message ?? String(e),
      details: err.details,
      hint: err.hint,
      code: err.code,
    }, 500);
  }
});
