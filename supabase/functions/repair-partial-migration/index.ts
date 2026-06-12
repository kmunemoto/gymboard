// GymBoard 側: 移行で部分投入された bookings / workouts を補修する関数。
// - 各お客様について Salute 側件数 > GymBoard 件数なら、その user_id の bookings/workouts を全削除→再投入。
// - batch_size で1回の処理人数を制限。
//
// 必要 Secrets:
//   - MIGRATION_SHARED_SECRET
//   - SALUTE_CUSTOMERS_URL (未設定なら SALUTE_EXPORT_URL から派生)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

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

    let body: { batch_size?: number; dry_run?: boolean } = {};
    try { body = await req.json(); } catch { /* default */ }
    const batchSize = Math.max(1, Math.min(28, Number(body.batch_size ?? 3)));
    const dryRun = Boolean(body.dry_run);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Salute から全員取得
    const url = `${SALUTE_CUSTOMERS_URL}?limit=500`;
    const upstream = await fetch(url, {
      method: "GET",
      headers: { "x-migration-secret": SHARED_SECRET, "Content-Type": "application/json" },
    });
    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      return json({ ok: false, step: "fetch_salute_customers", status: upstream.status, body: upstreamText }, 502);
    }
    const upstreamJson = JSON.parse(upstreamText);
    const customers: SaluteCustomer[] = upstreamJson?.customers ?? upstreamJson?.data ?? upstreamJson;
    if (!Array.isArray(customers)) {
      return json({ ok: false, error: "Unexpected upstream shape" }, 500);
    }

    // 2. exercise_id_map / migration_user_map をロード
    const { data: exMap } = await admin
      .from("exercise_id_map")
      .select("salute_exercise_id, gymboard_exercise_id")
      .eq("tenant_id", TENANT_ID);
    const exMapById = new Map<string, string>(
      (exMap ?? []).map((r) => [r.salute_exercise_id, r.gymboard_exercise_id]),
    );

    const { data: mapRows } = await admin
      .from("migration_user_map")
      .select("salute_user_id, gymboard_user_id, email")
      .eq("tenant_id", TENANT_ID);
    const gymIdBySalute = new Map<string, string>(
      (mapRows ?? []).map((m) => [m.salute_user_id, m.gymboard_user_id]),
    );
    const gymIdByEmail = new Map<string, string>(
      (mapRows ?? []).map((m) => [m.email.toLowerCase(), m.gymboard_user_id]),
    );

    // 3. 補修候補を抽出 (Salute件数 > GymBoard件数のお客様のみ)
    const candidates: Array<{
      c: SaluteCustomer;
      gymboardUserId: string;
      saluteBookings: number;
      saluteWorkouts: number;
      gymBookingsBefore: number;
      gymWorkoutsBefore: number;
      skippedBookingsBefore: number;
    }> = [];

    let totalSaluteBookings = 0;
    let totalSaluteWorkouts = 0;

    for (const c of customers) {
      const gymboardUserId =
        gymIdBySalute.get(c.user_id) ?? gymIdByEmail.get((c.email ?? "").toLowerCase());
      if (!gymboardUserId) continue;

      const saluteBookings = (c.bookings ?? []).length;
      const saluteWorkouts = (c.workouts ?? []).length;
      totalSaluteBookings += saluteBookings;
      totalSaluteWorkouts += saluteWorkouts;

      const { count: gymB } = await admin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", TENANT_ID)
        .eq("user_id", gymboardUserId);
      const { count: gymW } = await admin
        .from("workouts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", TENANT_ID)
        .eq("user_id", gymboardUserId);
      const { count: skippedB } = await admin
        .from("repair_skipped_bookings")
        .select("id", { count: "exact", head: true })
        .eq("gymboard_user_id", gymboardUserId);

      const gymBookingsBefore = gymB ?? 0;
      const gymWorkoutsBefore = gymW ?? 0;
      const skippedBookingsBefore = skippedB ?? 0;

      // overlap で恒久的に入らない分は「解消済み」とみなす
      if ((gymBookingsBefore + skippedBookingsBefore) < saluteBookings || gymWorkoutsBefore < saluteWorkouts) {
        candidates.push({
          c,
          gymboardUserId,
          saluteBookings,
          saluteWorkouts,
          gymBookingsBefore,
          gymWorkoutsBefore,
          skippedBookingsBefore,
        });
      }
    }

    const totalCandidates = candidates.length;
    const batch = candidates.slice(0, batchSize);
    const remaining = Math.max(0, totalCandidates - batch.length);

    const results: Array<Record<string, unknown>> = [];

    for (const cand of batch) {
      const { c, gymboardUserId, saluteBookings, saluteWorkouts, gymBookingsBefore, gymWorkoutsBefore, skippedBookingsBefore } = cand;
      const log: Record<string, unknown> = {
        email: c.email,
        gymboard_user_id: gymboardUserId,
        salute_bookings: saluteBookings,
        salute_workouts: saluteWorkouts,
        gym_bookings_before: gymBookingsBefore,
        gym_workouts_before: gymWorkoutsBefore,
        skipped_overlap_before: skippedBookingsBefore,
      };

      try {
        const needBookings = (gymBookingsBefore + skippedBookingsBefore) < saluteBookings;
        const needWorkouts = gymWorkoutsBefore < saluteWorkouts;

        if (dryRun) {
          log.status = "would_repair";
          log.repair_bookings = needBookings;
          log.repair_workouts = needWorkouts;
          results.push(log);
          continue;
        }

        // --- bookings 補修 (追加INSERTのみ。overlap で弾かれたものは repair_skipped_bookings に記録) ---
        let bookingsInserted = 0;
        let bookingsSkippedOverlap = 0;
        const bookingErrors: string[] = [];
        if (needBookings) {
          const { data: existing } = await admin
            .from("bookings")
            .select("booking_date")
            .eq("tenant_id", TENANT_ID)
            .eq("user_id", gymboardUserId);
          const existingDates = new Set((existing ?? []).map((r) => new Date(r.booking_date).toISOString()));

          const { data: alreadySkipped } = await admin
            .from("repair_skipped_bookings")
            .select("booking_date")
            .eq("gymboard_user_id", gymboardUserId);
          const skippedDates = new Set((alreadySkipped ?? []).map((r) => new Date(r.booking_date).toISOString()));

          for (const b of (c.bookings ?? [])) {
            const key = new Date(b.booking_date).toISOString();
            if (existingDates.has(key)) continue;
            if (skippedDates.has(key)) continue;
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
            if (error) {
              const msg = error.message ?? "";
              const isOverlap = msg.includes("この時間帯はすでに予約が入っています") || msg.toLowerCase().includes("overlap");
              if (isOverlap) {
                await admin
                  .from("repair_skipped_bookings")
                  .upsert(
                    {
                      salute_user_id: c.user_id,
                      gymboard_user_id: gymboardUserId,
                      booking_date: b.booking_date,
                      reason: "overlap",
                    },
                    { onConflict: "gymboard_user_id,booking_date", ignoreDuplicates: true },
                  );
                bookingsSkippedOverlap++;
              } else {
                bookingErrors.push(`${b.booking_date}: ${msg}`);
              }
            } else {
              bookingsInserted++;
            }
          }
        }

        // --- workouts 補修 (全削除 → 全件再投入) ---
        let workoutsInserted = 0;
        let workoutsSkippedNoExercise = 0;
        const workoutErrors: string[] = [];
        if (needWorkouts) {
          const { error: delErr } = await admin
            .from("workouts")
            .delete()
            .eq("tenant_id", TENANT_ID)
            .eq("user_id", gymboardUserId);
          if (delErr) throw new Error(`workouts delete: ${delErr.message}`);

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

        // 補修後の件数を再計測
        const { count: gymBAfter } = await admin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", TENANT_ID)
          .eq("user_id", gymboardUserId);
        const { count: gymWAfter } = await admin
          .from("workouts")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", TENANT_ID)
          .eq("user_id", gymboardUserId);
        const { count: skippedAfter } = await admin
          .from("repair_skipped_bookings")
          .select("id", { count: "exact", head: true })
          .eq("gymboard_user_id", gymboardUserId);

        log.status = "repaired";
        log.repaired_bookings = needBookings;
        log.repaired_workouts = needWorkouts;
        log.bookings_inserted = bookingsInserted;
        log.bookings_skipped_overlap = bookingsSkippedOverlap;
        log.workouts_inserted = workoutsInserted;
        log.workouts_skipped_no_exercise = workoutsSkippedNoExercise;
        log.gym_bookings_after = gymBAfter ?? 0;
        log.gym_workouts_after = gymWAfter ?? 0;
        log.skipped_overlap_total = skippedAfter ?? 0;
        if (bookingErrors.length) log.booking_errors = bookingErrors;
        if (workoutErrors.length) log.workout_errors = workoutErrors;
        results.push(log);
      } catch (e) {
        log.status = "error";
        log.error = e instanceof Error ? e.message : String(e);
        results.push(log);
      }
    }

    // 全体集計
    const { count: totalGymBookings } = await admin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    const { count: totalGymWorkouts } = await admin
      .from("workouts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", TENANT_ID);
    const { count: totalSkippedOverlap } = await admin
      .from("repair_skipped_bookings")
      .select("id", { count: "exact", head: true });

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      batch_size: batchSize,
      dry_run: dryRun,
      customers_fetched: customers.length,
      mapped_customers: gymIdBySalute.size,
      candidates_total: totalCandidates,
      processed_this_run: batch.length,
      remaining,
      totals: {
        salute_bookings_sum: totalSaluteBookings,
        salute_workouts_sum: totalSaluteWorkouts,
        gymboard_bookings_now: totalGymBookings ?? 0,
        gymboard_workouts_now: totalGymWorkouts ?? 0,
        repair_skipped_overlap_total: totalSkippedOverlap ?? 0,
      },
      results,
    }, 200);
  } catch (e) {
    const err = e as { message?: string };
    return json({ ok: false, error: err.message ?? String(e) }, 500);
  }
});
