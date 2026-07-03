// GymBoard 側: 指定期間の Salute データ (体重・体脂肪率・トレーニング記録) を取り込む。
// 初回移行後も Salute アプリ側で記録が続いていた期間 (例: 2026年6月) の追いつき用。
//
// Salute 側の追加デプロイは不要:
//   - トレーニング記録 → デプロイ済み salute-export-customers (workouts 同梱) を再利用
//   - 体重/体脂肪率   → デプロイ済み salute-export-measurements (全件) を取得し期間で絞る
//
// 取り込みルール:
//   - user_measurements: 期間内のみマージ UPSERT。Salute の非NULL値を優先し、
//     Salute が NULL の項目は GymBoard の既存値を保持。内容が同じ行はスキップ (冪等)。
//   - workouts: 「日単位の置き換え」。Salute に記録がある (user, workout_date) だけを対象に、
//     内容 (種目+セット+メモ) がマルチセットとして一致すればスキップ、異なれば
//     Salute の内容を先に挿入し、成功してから旧行を id 指定で削除する
//     (挿入失敗でその日が空になることを防ぎ、スナップショット後にアプリで直接
//     追加された行を巻き込まない)。Salute に記録が無い日 (GymBoard で直接入力した日)
//     には一切触れない。置き換えの単位はアプリ自身の編集動作
//     (TrainerClientDetail = 日単位の delete + reinsert) と同じセマンティクス。
//   - 種目は exercise_id_map で変換。未マッピング種目を含む日は「置き換えると行が
//     欠落する」ため日ごとスキップして報告 (先に prepare-import を実行して解消)。
//   - migration_user_map に無いお客様はスキップして報告 (先に migrate-customers を実行)。
//
// 備考:
//   - workouts の AFTER INSERT トリガー (ガチャ券/クエスト) は発火する。ガチャ券は
//     (user, session_date) で ON CONFLICT DO NOTHING のため重複付与なし。クエストの
//     ダメージは挿入行分だけ加算される。置き換えた日はアプリでその日を編集し直した
//     場合と同様に再加算される (アプリ自身の編集動作と同じ扱い)。
//   - BEFORE INSERT のプラン上限トリガー対策として事前に is_tenant_over_limit を確認。
//
// Body (POST のみ): { from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", dry_run?: boolean, max_days?: number }
//   デフォルト: from=2026-06-01, to=JST今日, max_days=500,
//   dry_run=true (誤実行防止のため既定は確認のみ。本実行は明示的に {"dry_run": false})
//
// 必要 Secrets:
//   - MIGRATION_SHARED_SECRET
//   - SALUTE_CUSTOMERS_URL / SALUTE_MEASUREMENTS_URL (未設定なら SALUTE_EXPORT_URL から派生)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeAdmin } from "../_shared/migrationAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

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
  workouts?: SaluteWorkout[];
};

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

function jstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// 数値を比較用に正規化 ("50.0" と 50 を同一視、null/undefined は空文字)
function numKey(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

// セット内容の正規化キー。sets(jsonb) があればそれを、無ければ legacy の weight/reps を使う
// (UI 側のフォールバック [{set:1, weight, reps}] と同じ扱い)。
function setsKey(sets: unknown, weight: unknown, reps: unknown): string {
  if (Array.isArray(sets) && sets.length > 0) {
    return sets
      .map((s) => {
        const o = (s ?? {}) as Record<string, unknown>;
        return { set: Number(o.set ?? 0), w: numKey(o.weight), r: numKey(o.reps) };
      })
      .sort((a, b) => a.set - b.set)
      .map((s) => `${s.set}:${s.w}:${s.r}`)
      .join(",");
  }
  return `1:${numKey(weight)}:${numKey(reps)}`;
}

// 1行 = 1種目の内容キー (種目 + セット内容 + メモ)
function workoutRowKey(exerciseId: string, sets: unknown, weight: unknown, reps: unknown, notes: unknown): string {
  return `${exerciseId}|${setsKey(sets, weight, reps)}|${typeof notes === "string" ? notes : ""}`;
}

// マルチセット (キー → 件数) の一致判定
function multisetEquals(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, n] of a) if (b.get(k) !== n) return false;
  return true;
}

function toMultiset(keys: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizeAdmin(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    const EXPORT_BASE = Deno.env.get("SALUTE_EXPORT_URL");
    let CUSTOMERS_URL = Deno.env.get("SALUTE_CUSTOMERS_URL");
    if (!CUSTOMERS_URL && EXPORT_BASE) {
      CUSTOMERS_URL = EXPORT_BASE.replace("salute-export-counts", "salute-export-customers");
    }
    let MEASUREMENTS_URL = Deno.env.get("SALUTE_MEASUREMENTS_URL");
    if (!MEASUREMENTS_URL && EXPORT_BASE) {
      MEASUREMENTS_URL = EXPORT_BASE
        .replace("salute-export-counts", "salute-export-measurements")
        .replace("salute-export-customers", "salute-export-measurements");
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SHARED_SECRET || !CUSTOMERS_URL || !MEASUREMENTS_URL) {
      return json({ ok: false, error: "Missing MIGRATION_SHARED_SECRET or SALUTE_*_URL/SALUTE_EXPORT_URL" }, 500);
    }

    if (req.method !== "POST") {
      return json({ ok: false, error: "POST のみ受け付けます (誤実行防止)。" }, 405);
    }
    let body: { from?: unknown; to?: unknown; dry_run?: unknown; max_days?: unknown } = {};
    try { body = await req.json(); } catch { /* default */ }
    const from = String(body.from ?? "2026-06-01").trim();
    const to = String(body.to ?? jstToday()).trim();
    // 誤実行防止: 既定は dry_run=true。本実行は boolean の false を明示する。
    if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
      return json({ ok: false, error: `dry_run は boolean で指定してください (受信値: ${JSON.stringify(body.dry_run)})` }, 400);
    }
    const dryRun = body.dry_run !== false;
    const maxDaysNum = Number(body.max_days ?? 500);
    const maxDays = Number.isFinite(maxDaysNum) ? Math.max(1, Math.min(2000, maxDaysNum)) : 500;
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      return json({ ok: false, error: `Invalid period: from=${from} to=${to} (YYYY-MM-DD, from <= to)` }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ===== 0. プラン上限の事前チェック (BEFORE INSERT トリガーで全滅しないように) =====
    const { data: overLimit, error: limitErr } = await admin.rpc("is_tenant_over_limit", { p_tenant_id: TENANT_ID });
    if (limitErr) {
      return json({ ok: false, step: "plan_limit_check", error: limitErr.message }, 500);
    }
    if (overLimit === true && !dryRun) {
      return json({
        ok: false,
        error: "テナントがプラン上限を超えているため取り込みできません。プランを見直すか dry_run で内容確認のみ行ってください。",
      }, 409);
    }

    // ===== 1. マッピング類を一括ロード =====
    const { data: userMap, error: umErr } = await admin
      .from("migration_user_map")
      .select("salute_user_id, gymboard_user_id, email")
      .eq("tenant_id", TENANT_ID);
    if (umErr) return json({ ok: false, step: "load_user_map", error: umErr.message }, 500);
    const mapBySaluteId = new Map<string, string>();
    const mapByEmail = new Map<string, string>();
    for (const m of userMap ?? []) {
      mapBySaluteId.set(m.salute_user_id, m.gymboard_user_id);
      if (m.email) mapByEmail.set(m.email.toLowerCase(), m.gymboard_user_id);
    }

    const { data: exMap, error: exErr } = await admin
      .from("exercise_id_map")
      .select("salute_exercise_id, gymboard_exercise_id")
      .eq("tenant_id", TENANT_ID);
    if (exErr) return json({ ok: false, step: "load_exercise_map", error: exErr.message }, 500);
    const exMapById = new Map<string, string>(
      (exMap ?? []).map((r) => [r.salute_exercise_id, r.gymboard_exercise_id]),
    );

    // ===== 2. Salute からデータ取得 =====
    const fetchSalute = async (url: string, step: string) => {
      const res = await fetch(url, {
        method: "GET",
        headers: { "x-migration-secret": SHARED_SECRET, "Content-Type": "application/json" },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${step}: upstream ${res.status} ${text.slice(0, 200)}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${step}: upstream returned non-JSON: ${text.slice(0, 200)}`);
      }
    };

    const custJson = await fetchSalute(`${CUSTOMERS_URL}?limit=500`, "fetch_salute_customers");
    const customers: SaluteCustomer[] = custJson?.customers ?? custJson?.data ?? custJson;
    if (!Array.isArray(customers)) {
      return json({ ok: false, error: "Unexpected customers shape", upstream: custJson }, 500);
    }

    const measJson = await fetchSalute(MEASUREMENTS_URL, "fetch_salute_measurements");
    const allMeasurements: SaluteMeasurement[] = measJson?.measurements ?? measJson?.data ?? measJson;
    if (!Array.isArray(allMeasurements)) {
      return json({ ok: false, error: "Unexpected measurements shape", upstream: measJson }, 500);
    }

    const resolveGymUserId = (c: { user_id: string; email?: string }) =>
      mapBySaluteId.get(c.user_id) ?? (c.email ? mapByEmail.get(c.email.toLowerCase()) : undefined) ?? null;

    // 体測定行にはメールが無いので、customers ペイロードから salute_user_id → email を引けるようにする
    const emailBySaluteId = new Map<string, string | null>(
      customers.map((c) => [c.user_id, c.email ?? null]),
    );

    // PostgREST の max-rows (既定1000行) による無言の切り捨てを避けるための全ページ取得
    const PAGE = 1000;
    const fetchAllPages = async <T>(
      build: (fromIdx: number, toIdx: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    ): Promise<T[]> => {
      const out: T[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await build(offset, offset + PAGE - 1);
        if (error) throw new Error(error.message);
        out.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return out;
    };

    // 未マッピングのお客様 (期間内にデータがある人だけ報告)
    const unmappedUsers: Array<{ salute_user_id: string; email: string | null; workouts_in_range: number; measurements_in_range: number }> = [];

    // ===== 3. 体重・体脂肪率 (user_measurements) =====
    const measInRange = allMeasurements.filter((m) => m.measured_date >= from && m.measured_date <= to);

    // Salute 側エクスポートに万一 (user, date) の重複があっても 1 チャンク内の
    // ON CONFLICT 二重更新 (エラー 21000) にならないよう防御的にマージ (非NULL優先・後勝ち)
    const measDedup = new Map<string, SaluteMeasurement>();
    for (const m of measInRange) {
      const key = `${m.user_id}|${m.measured_date}`;
      const prev = measDedup.get(key);
      measDedup.set(key, prev
        ? { ...m, weight: m.weight ?? prev.weight, body_fat: m.body_fat ?? prev.body_fat, created_at: m.created_at ?? prev.created_at }
        : m);
    }

    const measByGymUser = new Map<string, SaluteMeasurement[]>();
    let measUnmappedRows = 0;
    const measUnmappedBySalute = new Map<string, number>();
    {
      // ユーザー解決は workouts と同じ規則 (salute_user_id → email フォールバック)。
      // 旧アカウント併存などで複数の Salute ユーザーが同一 GymBoard ユーザーへ解決される
      // 場合に備え、(gymboard_user, date) 単位でも最終マージする (1チャンク内で同一
      // 競合キーが2回現れると UPSERT 全体が失敗するため)。
      const byGymKey = new Map<string, { gymId: string; m: SaluteMeasurement }>();
      for (const m of measDedup.values()) {
        const gymId = resolveGymUserId({ user_id: m.user_id, email: emailBySaluteId.get(m.user_id) ?? undefined });
        if (!gymId) {
          measUnmappedRows++;
          measUnmappedBySalute.set(m.user_id, (measUnmappedBySalute.get(m.user_id) ?? 0) + 1);
          continue;
        }
        const key = `${gymId}|${m.measured_date}`;
        const prev = byGymKey.get(key);
        byGymKey.set(key, prev
          ? { gymId, m: { ...m, weight: m.weight ?? prev.m.weight, body_fat: m.body_fat ?? prev.m.body_fat, created_at: m.created_at ?? prev.m.created_at } }
          : { gymId, m });
      }
      for (const { gymId, m } of byGymKey.values()) {
        const arr = measByGymUser.get(gymId) ?? [];
        arr.push(m);
        measByGymUser.set(gymId, arr);
      }
    }

    const measResult = { salute_rows_in_range: measInRange.length, inserted: 0, updated: 0, unchanged: 0, skipped_unmapped_rows: measUnmappedRows, skipped_other_tenant: 0, errors: [] as string[] };

    if (measByGymUser.size > 0) {
      const gymIds = [...measByGymUser.keys()];
      let existingMeas: Array<{ user_id: string; measured_date: string; weight: number | null; body_fat: number | null; tenant_id: string | null }>;
      try {
        existingMeas = await fetchAllPages((a, b) =>
          admin
            .from("user_measurements")
            .select("user_id, measured_date, weight, body_fat, tenant_id")
            .in("user_id", gymIds)
            .gte("measured_date", from)
            .lte("measured_date", to)
            .order("measured_date", { ascending: true })
            .order("user_id", { ascending: true })
            .range(a, b),
        );
      } catch (e) {
        return json({ ok: false, step: "load_existing_measurements", error: e instanceof Error ? e.message : String(e) }, 500);
      }
      const existingByKey = new Map<string, { weight: number | null; body_fat: number | null; tenant_id: string | null }>(
        existingMeas.map((r) => [`${r.user_id}|${r.measured_date}`, { weight: r.weight, body_fat: r.body_fat, tenant_id: r.tenant_id }]),
      );

      const newRows: Array<Record<string, unknown>> = [];
      const updateRows: Array<Record<string, unknown>> = [];
      for (const [gymId, rows] of measByGymUser) {
        for (const m of rows) {
          const existing = existingByKey.get(`${gymId}|${m.measured_date}`);
          if (!existing) {
            newRows.push({
              user_id: gymId,
              tenant_id: TENANT_ID,
              measured_date: m.measured_date,
              weight: m.weight,
              body_fat: m.body_fat,
              // 全行でキー構成を揃える (混在すると PostgREST が一括 INSERT を拒否する)
              created_at: m.created_at ?? new Date().toISOString(),
            });
            continue;
          }
          // 同一ユーザーが別テナントにも所属している場合、その行は乗っ取らない
          // (UNIQUE(user_id, measured_date) はテナントを含まないため衝突し得る)
          if (existing.tenant_id && existing.tenant_id !== TENANT_ID) {
            measResult.skipped_other_tenant++;
            continue;
          }
          // マージ: Salute の非NULL値を優先、NULL は既存値を保持
          const mergedWeight = m.weight ?? existing.weight;
          const mergedBodyFat = m.body_fat ?? existing.body_fat;
          if (numKey(mergedWeight) === numKey(existing.weight) && numKey(mergedBodyFat) === numKey(existing.body_fat)) {
            measResult.unchanged++;
            continue;
          }
          updateRows.push({
            user_id: gymId,
            tenant_id: TENANT_ID,
            measured_date: m.measured_date,
            weight: mergedWeight,
            body_fat: mergedBodyFat,
          });
        }
      }

      if (!dryRun) {
        for (let i = 0; i < newRows.length; i += 200) {
          const chunk = newRows.slice(i, i + 200);
          // 読み取り後にアプリ側で直接入力された行と衝突した場合は DO NOTHING で
          // アプリ側の値を守る (Salute の NULL で上書きしない保証を競合時も維持)
          const { data: ins, error } = await admin
            .from("user_measurements")
            .upsert(chunk, { onConflict: "user_id,measured_date", ignoreDuplicates: true })
            .select("user_id");
          if (error) measResult.errors.push(`insert chunk ${i}: ${error.message}`);
          else measResult.inserted += (ins ?? []).length;
        }
        for (let i = 0; i < updateRows.length; i += 200) {
          const chunk = updateRows.slice(i, i + 200);
          const { error } = await admin
            .from("user_measurements")
            .upsert(chunk, { onConflict: "user_id,measured_date" });
          if (error) measResult.errors.push(`update chunk ${i}: ${error.message}`);
          else measResult.updated += chunk.length;
        }
      } else {
        measResult.inserted = newRows.length;
        measResult.updated = updateRows.length;
      }
    }

    // ===== 4. トレーニング記録 (workouts) — 日単位の置き換え =====
    const workoutsResult = {
      salute_rows_in_range: 0,
      days_total: 0,
      days_unchanged: 0,
      days_added: 0,
      days_replaced: 0,
      days_skipped_no_exercise: 0,
      days_remaining: 0,
      rows_inserted: 0,
      rows_deleted: 0,
      errors: [] as string[],
    };
    const skippedNoExerciseDetail: Array<{ email: string | null; workout_date: string; salute_exercise_ids: string[] }> = [];

    // (user, date) ごとに Salute 行をグルーピング
    type DayGroup = { gymUserId: string; email: string | null; date: string; rows: SaluteWorkout[] };
    const dayGroups: DayGroup[] = [];
    for (const c of customers) {
      const inRange = (c.workouts ?? []).filter((w) => w.workout_date >= from && w.workout_date <= to);
      if (inRange.length === 0) continue;
      const gymId = resolveGymUserId(c);
      if (!gymId) {
        unmappedUsers.push({
          salute_user_id: c.user_id,
          email: c.email ?? null,
          workouts_in_range: inRange.length,
          measurements_in_range: measUnmappedBySalute.get(c.user_id) ?? 0,
        });
        continue;
      }
      workoutsResult.salute_rows_in_range += inRange.length;
      const byDate = new Map<string, SaluteWorkout[]>();
      for (const w of inRange) {
        const arr = byDate.get(w.workout_date) ?? [];
        arr.push(w);
        byDate.set(w.workout_date, arr);
      }
      for (const [date, rows] of byDate) {
        dayGroups.push({ gymUserId: gymId, email: c.email ?? null, date, rows });
      }
    }
    // 期間内に体測定だけある未マッピングユーザーも報告に含める
    for (const [saluteId, count] of measUnmappedBySalute) {
      if (!unmappedUsers.some((u) => u.salute_user_id === saluteId)) {
        unmappedUsers.push({
          salute_user_id: saluteId,
          email: emailBySaluteId.get(saluteId) ?? null,
          workouts_in_range: 0,
          measurements_in_range: count,
        });
      }
    }

    // 複数の Salute アカウント (旧+新) が同一 GymBoard ユーザーへ解決された場合、
    // 同じ (user, date) のグループを統合して二重処理・二重挿入を防ぐ
    const dayGroupByKey = new Map<string, DayGroup>();
    for (const g of dayGroups) {
      const key = `${g.gymUserId}|${g.date}`;
      const prev = dayGroupByKey.get(key);
      if (prev) prev.rows.push(...g.rows);
      else dayGroupByKey.set(key, g);
    }
    const mergedDayGroups = [...dayGroupByKey.values()];

    workoutsResult.days_total = mergedDayGroups.length;
    mergedDayGroups.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // 既存の GymBoard 行を期間まとめて 1 クエリでロード
    const woGymIds = [...new Set(mergedDayGroups.map((g) => g.gymUserId))];
    const existingWoByUserDate = new Map<string, Array<{ id: string; exercise_id: string; weight: number | null; reps: number | null; sets: unknown; notes: string | null }>>();
    if (woGymIds.length > 0) {
      let existingWo: Array<{ id: string; user_id: string; exercise_id: string; workout_date: string; weight: number | null; reps: number | null; sets: unknown; notes: string | null }>;
      try {
        existingWo = await fetchAllPages((a, b) =>
          admin
            .from("workouts")
            .select("id, user_id, exercise_id, workout_date, weight, reps, sets, notes")
            .eq("tenant_id", TENANT_ID)
            .in("user_id", woGymIds)
            .gte("workout_date", from)
            .lte("workout_date", to)
            .order("id", { ascending: true })
            .range(a, b),
        );
      } catch (e) {
        return json({ ok: false, step: "load_existing_workouts", error: e instanceof Error ? e.message : String(e) }, 500);
      }
      for (const r of existingWo) {
        const key = `${r.user_id}|${r.workout_date}`;
        const arr = existingWoByUserDate.get(key) ?? [];
        arr.push(r);
        existingWoByUserDate.set(key, arr);
      }
    }

    // max_days は「書き込みを行う日数」の上限。unchanged の日は消費しないため、
    // 再実行すれば前回書いた日が unchanged になり、残りの日へ確実に前進する。
    let writesUsed = 0;

    for (const g of mergedDayGroups) {
      try {
        // 種目マッピング。1件でも未解決ならこの日はスキップ (欠落置き換え防止)
        const mappedRows: Array<{ gymExerciseId: string; w: SaluteWorkout }> = [];
        const unmappedExIds: string[] = [];
        for (const w of g.rows) {
          const salExId = w.salute_exercise_id ?? w.exercise_id ?? null;
          const gymEx = salExId ? exMapById.get(salExId) : undefined;
          if (!gymEx) unmappedExIds.push(salExId ?? "(null)");
          else mappedRows.push({ gymExerciseId: gymEx, w });
        }
        if (unmappedExIds.length > 0) {
          workoutsResult.days_skipped_no_exercise++;
          skippedNoExerciseDetail.push({ email: g.email, workout_date: g.date, salute_exercise_ids: [...new Set(unmappedExIds)] });
          continue;
        }

        const saluteKeys = mappedRows.map(({ gymExerciseId, w }) =>
          workoutRowKey(gymExerciseId, w.sets, w.weight, w.reps, w.notes));
        const existing = existingWoByUserDate.get(`${g.gymUserId}|${g.date}`) ?? [];
        const existingKeys = existing.map((r) => workoutRowKey(r.exercise_id, r.sets, r.weight, r.reps, r.notes));

        if (multisetEquals(toMultiset(saluteKeys), toMultiset(existingKeys))) {
          workoutsResult.days_unchanged++;
          continue;
        }

        if (writesUsed >= maxDays) {
          workoutsResult.days_remaining++;
          continue;
        }
        writesUsed++;

        if (!dryRun) {
          const insertRows = mappedRows.map(({ gymExerciseId, w }) => ({
            user_id: g.gymUserId,
            tenant_id: TENANT_ID,
            exercise_id: gymExerciseId,
            workout_date: g.date,
            weight: w.weight,
            reps: w.reps,
            sets: w.sets ?? null,
            notes: w.notes,
            // 全行でキー構成を揃える (混在すると PostgREST が一括 INSERT を拒否する)
            created_at: w.created_at ?? new Date().toISOString(),
          }));
          // 先に挿入し、成功してから旧行を id 指定で削除する。
          // - 挿入が失敗してもその日のデータは失われない
          // - id 指定のため、スナップショット後にアプリで直接追加された行を巻き込まない
          // - 削除だけ失敗した場合は新旧が重複するが、再実行時にマルチセット不一致として
          //   検出され再置き換えで収束する
          const { error: insErr } = await admin.from("workouts").insert(insertRows);
          if (insErr) throw new Error(`insert: ${insErr.message}`);
          workoutsResult.rows_inserted += insertRows.length;
          if (existing.length > 0) {
            const { error: delErr } = await admin
              .from("workouts")
              .delete()
              .in("id", existing.map((r) => r.id));
            if (delErr) throw new Error(`delete (新行は挿入済み・旧行が残っています): ${delErr.message}`);
            workoutsResult.rows_deleted += existing.length;
            workoutsResult.days_replaced++;
          } else {
            workoutsResult.days_added++;
          }
        } else {
          workoutsResult.rows_inserted += mappedRows.length;
          workoutsResult.rows_deleted += existing.length;
          if (existing.length > 0) workoutsResult.days_replaced++;
          else workoutsResult.days_added++;
        }
      } catch (e) {
        workoutsResult.errors.push(`${g.email ?? g.gymUserId} ${g.date}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // ===== 5. ヒント =====
    const errorsTotal = measResult.errors.length + workoutsResult.errors.length;
    const hints: string[] = [];
    if (dryRun) {
      hints.push('これは dry_run です (書き込みなし)。内容を確認できたら {"dry_run": false} を指定して本実行してください。');
    }
    if (errorsTotal > 0) {
      hints.push(`一部の処理が失敗しました (${errorsTotal}件)。measurements.errors / workouts.errors を確認してください。再実行すると失敗分のみ再試行されます。`);
    }
    if (unmappedUsers.length > 0) {
      hints.push("migration_user_map に無いお客様が期間内にデータを持っています。先に migrate-customers を実行してから、この関数を再実行してください。");
    }
    if (workoutsResult.days_skipped_no_exercise > 0) {
      hints.push("exercise_id_map に無い種目を含む日をスキップしました。先に prepare-import を実行してから、この関数を再実行してください。");
    }
    if (workoutsResult.days_remaining > 0) {
      hints.push(`max_days の上限により ${workoutsResult.days_remaining} 日分が未処理です。この関数をもう一度実行してください (処理済みの日は unchanged としてスキップされ、残りが処理されます)。`);
    }
    if (customers.length >= 500) {
      hints.push("salute-export-customers が上限 (500件) に達しています。お客様の取得漏れがある可能性があります。");
    }
    if (overLimit === true && dryRun) {
      hints.push("テナントがプラン上限を超えています。dry_run=false での実行は拒否されます。");
    }

    return json({
      ok: errorsTotal === 0,
      dry_run: dryRun,
      errors_total: errorsTotal,
      from,
      to,
      tenant_id: TENANT_ID,
      customers_fetched: customers.length,
      measurements: measResult,
      workouts: workoutsResult,
      unmapped_users: unmappedUsers,
      workouts_days_skipped_no_exercise_detail: skippedNoExerciseDetail,
      hints,
    }, 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
