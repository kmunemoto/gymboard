// reconcile-bookings-from-salute
// Salute を正として GymBoard の予約 (source='salute_sync') と blocked_slots
// (source='salute_sync') を丸ごと一致させる定期照合。
//
// - 個別イベント同期 (gymboard-sync-booking) の取りこぼし対策の安全網。
// - source='gymboard' (GymBoard発の予約) には絶対に触らない。
// - dry_run=true (デフォルト) で差分のみを返し、実データは変更しない。
//   dry_run=false で実際に挿入・削除を行う。
// - 冪等。再実行で同じ結果。
//
// 環境変数:
//   - MIGRATION_SHARED_SECRET
//   - SALUTE_SUPABASE_URL  (例: https://<ref>.supabase.co)
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (自動注入)
//
// 使い方:
//   GET  /reconcile-bookings-from-salute                       -> dry_run=true レポート
//   POST /reconcile-bookings-from-salute   { "dry_run": false } -> 実反映
//   ?from=2026-06-01 で開始日上書き可。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { authorizeAdmin } from "../_shared/migrationAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";
const DEFAULT_FROM = "2026-06-01";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeBookingType(t: string | null | undefined): string | null {
  if (!t) return t ?? null;
  if (t === "月8回プラン") return "月8回";
  return t;
}

// booking_date を ISO 文字列に正規化 (timestamptz 比較キー)
function normalizeTs(s: string): string {
  return new Date(s).toISOString();
}

type SaluteBooking = {
  user_id: string;
  booking_date: string;
  status?: string | null;
  booking_type?: string | null;
};

type SaluteBlocked = {
  blocked_date: string;
  end_blocked_date: string;
  reason?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!authorizeAdmin(req)) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SALUTE_URL_BASE = Deno.env.get("SALUTE_SUPABASE_URL");

    if (!SHARED_SECRET) return json({ ok: false, error: "MIGRATION_SHARED_SECRET missing" }, 500);
    if (!SALUTE_URL_BASE) return json({ ok: false, error: "SALUTE_SUPABASE_URL missing" }, 500);

    // dry_run の決定
    const url = new URL(req.url);
    const fromDate = url.searchParams.get("from") ?? DEFAULT_FROM;
    let dryRun = true;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && typeof body.dry_run === "boolean") dryRun = body.dry_run;
      } catch {
        // 本文無しは dry_run=true 扱い
      }
    }
    const qpDry = url.searchParams.get("dry_run");
    if (qpDry === "false" || qpDry === "0") dryRun = false;
    if (qpDry === "true" || qpDry === "1") dryRun = true;

    const saluteBase = SALUTE_URL_BASE.replace(/\/$/, "");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ============================================================
    // 1. 予約のミラーリング
    // ============================================================

    // 1-A) Salute の現役予約を取得
    const bookingsRes = await fetch(
      `${saluteBase}/functions/v1/salute-export-bookings?from=${fromDate}`,
      { method: "GET", headers: { "x-migration-secret": SHARED_SECRET } },
    );
    if (!bookingsRes.ok) {
      const txt = await bookingsRes.text();
      return json({ ok: false, step: "salute_export_bookings", status: bookingsRes.status, body: txt.slice(0, 500) }, 200);
    }
    const bookingsPayload = await bookingsRes.json();
    const saluteBookings: SaluteBooking[] = Array.isArray(bookingsPayload)
      ? bookingsPayload
      : Array.isArray(bookingsPayload?.bookings)
        ? bookingsPayload.bookings
        : Array.isArray(bookingsPayload?.data)
          ? bookingsPayload.data
          : [];

    // 1-B) user_id 変換マップ (salute -> gymboard)
    const { data: mapRows, error: mapErr } = await admin
      .from("migration_user_map")
      .select("gymboard_user_id, salute_user_id")
      .eq("tenant_id", TENANT_ID);
    if (mapErr) return json({ ok: false, step: "fetch_map", error: mapErr.message }, 200);
    const salute2gb = new Map<string, string>();
    for (const r of mapRows ?? []) {
      if (r.salute_user_id && r.gymboard_user_id) {
        salute2gb.set(r.salute_user_id as string, r.gymboard_user_id as string);
      }
    }

    // 1-C) Salute -> 望ましい GymBoard 行集合 S
    type DesiredBooking = {
      key: string;
      user_id: string;
      booking_date: string;
      booking_type: string | null;
      status: string;
      salute_user_id: string;
    };
    const desiredMap = new Map<string, DesiredBooking>();
    let skippedUnmapped = 0;
    let skippedCancelled = 0;
    for (const sb of saluteBookings) {
      if (!sb.user_id || !sb.booking_date) continue;
      const status = String(sb.status ?? "予約済み");
      if (status === "キャンセル済み" || status === "cancelled" || status === "キャンセル") {
        skippedCancelled += 1;
        continue;
      }
      const gbUser = salute2gb.get(sb.user_id);
      if (!gbUser) {
        skippedUnmapped += 1;
        continue;
      }
      const ts = normalizeTs(sb.booking_date);
      const key = `${gbUser}|${ts}`;
      desiredMap.set(key, {
        key,
        user_id: gbUser,
        booking_date: sb.booking_date,
        booking_type: normalizeBookingType(sb.booking_type ?? "通常"),
        status,
        salute_user_id: sb.user_id,
      });
    }

    // 1-D) GymBoard 側 管理対象集合 G
    // - 通常: source='salute_sync' のみ
    // - 6月 (2026-06-01 〜 2026-06-30 JST = 2026-05-31T15:00Z 〜 2026-06-30T15:00Z UTC):
    //   guard により GymBoard 発の正規予約は存在し得ない。よって source=NULL も
    //   ミラー対象に含め、Salute に無いものは削除する。
    //   source='gymboard' は6月でも対象外 (保護・報告のみ)。
    const JUNE_START_UTC = "2026-05-31T15:00:00+00:00";
    const JUNE_END_UTC = "2026-06-30T15:00:00+00:00";
    const orFilter =
      "source.eq.salute_sync,and(source.is.null,booking_date.gte." +
      JUNE_START_UTC + ",booking_date.lt." + JUNE_END_UTC + ")";
    const { data: gbRows, error: gbErr } = await admin
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, status, source")
      .eq("tenant_id", TENANT_ID)
      .gte("booking_date", fromDate)
      .or(orFilter);
    if (gbErr) return json({ ok: false, step: "fetch_gb_bookings", error: gbErr.message }, 200);

    // 6月の source='gymboard' (本来あり得ないが、あれば保護・報告のみ)
    const { data: juneGymboardPreserved } = await admin
      .from("bookings")
      .select("id, user_id, booking_date")
      .eq("tenant_id", TENANT_ID)
      .eq("source", "gymboard")
      .gte("booking_date", JUNE_START_UTC)
      .lt("booking_date", JUNE_END_UTC);

    const existingMap = new Map<string, { id: string; user_id: string; booking_date: string; source: string | null }>();
    for (const b of gbRows ?? []) {
      const ts = normalizeTs(b.booking_date as string);
      const key = `${b.user_id}|${ts}`;
      existingMap.set(key, {
        id: b.id as string,
        user_id: b.user_id as string,
        booking_date: b.booking_date as string,
        source: (b.source as string | null) ?? null,
      });
    }

    // 1-E) 差分
    const toInsert: DesiredBooking[] = [];
    for (const [k, v] of desiredMap) {
      if (!existingMap.has(k)) toInsert.push(v);
    }
    const toDelete: { id: string; user_id: string; booking_date: string; source: string | null }[] = [];
    for (const [k, v] of existingMap) {
      if (!desiredMap.has(k)) toDelete.push(v);
    }

    let bookingsInserted = 0;
    let bookingsDeleted = 0;
    const insertErrors: unknown[] = [];
    const deleteErrors: unknown[] = [];

    if (!dryRun) {
      // 削除を先に: 同じ日付でユーザー時刻変更 (旧→新) があるとき、新を先に挿入すると
      // 同日重複制約には引っ掛からない (overlap は salute_sync 例外) ので順序問題は無いが
      // 念のため削除を先にする。
      for (const d of toDelete) {
        // 6月の source=NULL (legacy) は guard により直接 DELETE できない。
        // 先に source='salute_sync' に昇格させてから削除する (どちらも guard 例外)。
        if (d.source === null) {
          const { error: upErr } = await admin
            .from("bookings")
            .update({ source: "salute_sync" })
            .eq("id", d.id);
          if (upErr) {
            deleteErrors.push({ id: d.id, step: "promote_null_source", error: upErr.message });
            continue;
          }
        }
        const { error } = await admin
          .from("bookings")
          .delete()
          .eq("id", d.id)
          .eq("source", "salute_sync");
        if (error) deleteErrors.push({ id: d.id, error: error.message });
        else bookingsDeleted += 1;
      }
      for (const i of toInsert) {
        const { error } = await admin.from("bookings").insert({
          tenant_id: TENANT_ID,
          user_id: i.user_id,
          booking_date: i.booking_date,
          booking_type: i.booking_type ?? "通常",
          status: i.status,
          source: "salute_sync",
        });
        if (error) insertErrors.push({ user_id: i.user_id, booking_date: i.booking_date, error: error.message });
        else bookingsInserted += 1;
      }
    }

    // ============================================================
    // 2. blocked_slots のミラーリング
    // ============================================================

    const blockedRes = await fetch(
      `${saluteBase}/functions/v1/salute-export-blocked-slots`,
      { method: "GET", headers: { "x-migration-secret": SHARED_SECRET } },
    );
    let saluteBlocked: SaluteBlocked[] = [];
    let blockedFetchError: string | null = null;
    if (!blockedRes.ok) {
      blockedFetchError = `HTTP ${blockedRes.status}: ${(await blockedRes.text()).slice(0, 300)}`;
    } else {
      const p = await blockedRes.json();
      saluteBlocked = Array.isArray(p)
        ? p
        : Array.isArray(p?.blocked_slots)
          ? p.blocked_slots
          : Array.isArray(p?.data)
            ? p.data
            : [];
    }

    // テナントの代表 created_by (オーナー) を取得
    const { data: tenantRow } = await admin
      .from("tenants")
      .select("owner_user_id")
      .eq("id", TENANT_ID)
      .maybeSingle();
    const defaultCreatedBy = (tenantRow?.owner_user_id as string | undefined) ?? null;

    // Salute -> 望ましい blocked_slots 集合
    type DesiredBlocked = {
      key: string;
      blocked_date: string;
      end_blocked_date: string;
      reason: string | null;
    };
    const desiredBlocked = new Map<string, DesiredBlocked>();
    for (const sb of saluteBlocked) {
      if (!sb.blocked_date || !sb.end_blocked_date) continue;
      const startTs = normalizeTs(sb.blocked_date);
      const endTs = normalizeTs(sb.end_blocked_date);
      const key = `${startTs}|${endTs}`;
      desiredBlocked.set(key, {
        key,
        blocked_date: sb.blocked_date,
        end_blocked_date: sb.end_blocked_date,
        reason: sb.reason ?? null,
      });
    }

    // GymBoard 側 salute_sync の blocked_slots
    const { data: gbBlockedRows, error: gbBlockedErr } = await admin
      .from("blocked_slots")
      .select("id, blocked_date, end_blocked_date, reason, source")
      .eq("tenant_id", TENANT_ID)
      .eq("source", "salute_sync");
    if (gbBlockedErr) return json({ ok: false, step: "fetch_gb_blocked", error: gbBlockedErr.message }, 200);

    const existingBlocked = new Map<string, { id: string; blocked_date: string; end_blocked_date: string }>();
    for (const b of gbBlockedRows ?? []) {
      const k = `${normalizeTs(b.blocked_date as string)}|${normalizeTs(b.end_blocked_date as string)}`;
      existingBlocked.set(k, {
        id: b.id as string,
        blocked_date: b.blocked_date as string,
        end_blocked_date: b.end_blocked_date as string,
      });
    }

    const blockedToInsert: DesiredBlocked[] = [];
    for (const [k, v] of desiredBlocked) if (!existingBlocked.has(k)) blockedToInsert.push(v);
    const blockedToDelete: { id: string; blocked_date: string; end_blocked_date: string }[] = [];
    for (const [k, v] of existingBlocked) if (!desiredBlocked.has(k)) blockedToDelete.push(v);

    let blockedInserted = 0;
    let blockedDeleted = 0;
    const blockedInsertErrors: unknown[] = [];
    const blockedDeleteErrors: unknown[] = [];

    if (!dryRun && !blockedFetchError) {
      if (!defaultCreatedBy) {
        return json({ ok: false, step: "blocked_default_created_by", error: "tenants.owner_user_id is null" }, 200);
      }
      for (const d of blockedToDelete) {
        const { error } = await admin
          .from("blocked_slots")
          .delete()
          .eq("id", d.id)
          .eq("source", "salute_sync");
        if (error) blockedDeleteErrors.push({ id: d.id, error: error.message });
        else blockedDeleted += 1;
      }
      for (const i of blockedToInsert) {
        const { error } = await admin.from("blocked_slots").insert({
          tenant_id: TENANT_ID,
          blocked_date: i.blocked_date,
          end_blocked_date: i.end_blocked_date,
          reason: i.reason,
          created_by: defaultCreatedBy,
          source: "salute_sync",
        });
        if (error) blockedInsertErrors.push({ blocked_date: i.blocked_date, error: error.message });
        else blockedInserted += 1;
      }
    }

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      dry_run: dryRun,
      from: fromDate,
      bookings: {
        salute_total: saluteBookings.length,
        skipped_unmapped_user: skippedUnmapped,
        skipped_cancelled: skippedCancelled,
        gymboard_managed_total: existingMap.size,
        june_legacy_null_source_in_delete: toDelete.filter((x) => x.source === null).length,
        june_gymboard_source_preserved: (juneGymboardPreserved ?? []).length,
        june_gymboard_source_preserved_rows: juneGymboardPreserved ?? [],
        to_insert: toInsert.map((x) => ({
          user_id: x.user_id,
          salute_user_id: x.salute_user_id,
          booking_date: x.booking_date,
          booking_type: x.booking_type,
          status: x.status,
        })),
        to_delete: toDelete.map((x) => ({
          id: x.id,
          user_id: x.user_id,
          booking_date: x.booking_date,
          source: x.source,
        })),
        applied: dryRun ? null : { inserted: bookingsInserted, deleted: bookingsDeleted, insert_errors: insertErrors, delete_errors: deleteErrors },
      },
      blocked_slots: {
        fetch_error: blockedFetchError,
        salute_total: saluteBlocked.length,
        gymboard_salute_sync_total: existingBlocked.size,
        to_insert: blockedToInsert,
        to_delete: blockedToDelete,
        applied: dryRun || blockedFetchError
          ? null
          : { inserted: blockedInserted, deleted: blockedDeleted, insert_errors: blockedInsertErrors, delete_errors: blockedDeleteErrors },
      },
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
