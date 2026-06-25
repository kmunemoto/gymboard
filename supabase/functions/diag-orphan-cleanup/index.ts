// diag-orphan-cleanup
// GymBoard 側 bookings (tenant=ceda19b0, source='salute_sync', booking_date>=2026-06-01) と
// Salute 側 salute-export-bookings(active) を突合し、
// 「Salute 側に存在しない salute_sync 予約」= orphan を特定する。
//
// GET (default): レポートのみ (削除しない)
// POST ?delete=1: orphan を GymBoard の bookings から物理削除する

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

import { authorizeAdmin } from "../_shared/migrationAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";
const FROM_DATE = "2026-06-01";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

type GbBooking = {
  id: string;
  user_id: string;
  booking_date: string;
  booking_type: string | null;
  status: string | null;
  source: string | null;
};

type SaluteBooking = {
  id?: string;
  user_id: string;
  booking_date: string;
  status?: string | null;
  booking_type?: string | null;
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

    const url = new URL(req.url);
    const doDelete = url.searchParams.get("delete") === "1" && req.method === "POST";

    const saluteBase = SALUTE_URL_BASE.replace(/\/$/, "");
    const exportUrl = `${saluteBase}/functions/v1/salute-export-bookings?from=${FROM_DATE}`;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) GymBoard: salute_sync 予約
    const { data: gbRows, error: gbErr } = await admin
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, status, source")
      .eq("tenant_id", TENANT_ID)
      .eq("source", "salute_sync")
      .gte("booking_date", FROM_DATE)
      .order("booking_date");
    if (gbErr) return json({ ok: false, step: "fetch_gb", error: gbErr.message }, 200);
    const gbBookings = (gbRows ?? []) as GbBooking[];

    // 2) Salute: active な予約
    const res = await fetch(exportUrl, {
      method: "GET",
      headers: { "x-migration-secret": SHARED_SECRET },
    });
    if (!res.ok) {
      const txt = await res.text();
      return json({ ok: false, step: "salute_export", status: res.status, body: txt.slice(0, 500) }, 200);
    }
    const payload = await res.json();
    const saluteBookings: SaluteBooking[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.bookings)
        ? payload.bookings
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

    // 3) user_id 変換マップ
    const gbUserIds = Array.from(new Set(gbBookings.map((b) => b.user_id)));
    const { data: mapRows } = await admin
      .from("migration_user_map")
      .select("gymboard_user_id, salute_user_id")
      .eq("tenant_id", TENANT_ID)
      .in("gymboard_user_id", gbUserIds.length ? gbUserIds : ["00000000-0000-0000-0000-000000000000"]);
    const gb2salute = new Map<string, string>();
    for (const r of mapRows ?? []) {
      if (r.gymboard_user_id && r.salute_user_id) {
        gb2salute.set(r.gymboard_user_id as string, r.salute_user_id as string);
      }
    }

    // 4) Salute インデックス (salute_user_id|normalized_date)
    const saluteIndex = new Set<string>();
    for (const sb of saluteBookings) {
      if (!sb.user_id || !sb.booking_date) continue;
      const nd = normalizeDate(sb.booking_date);
      if (!nd) continue;
      saluteIndex.add(`${sb.user_id}|${nd}`);
    }

    // 5) 突合
    type Row = GbBooking & {
      salute_user_id: string | null;
      classification: "ok" | "orphan" | "unmapped_user";
    };
    const classified: Row[] = [];
    for (const b of gbBookings) {
      const su = gb2salute.get(b.user_id) ?? null;
      const nd = normalizeDate(b.booking_date);
      let cls: Row["classification"] = "orphan";
      if (!su) cls = "unmapped_user";
      else if (nd && saluteIndex.has(`${su}|${nd}`)) cls = "ok";
      classified.push({ ...b, salute_user_id: su, classification: cls });
    }

    const orphans = classified.filter((r) => r.classification === "orphan");
    const oks = classified.filter((r) => r.classification === "ok");
    const unmapped = classified.filter((r) => r.classification === "unmapped_user");

    const byMonth = (rows: Row[]) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const k = monthOf(r.booking_date);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return Object.fromEntries(m);
    };

    const counts = {
      total_salute_sync: classified.length,
      ok: oks.length,
      orphan: orphans.length,
      unmapped_user: unmapped.length,
      salute_total: saluteBookings.length,
      by_month: {
        orphan: byMonth(orphans),
        ok: byMonth(oks),
        unmapped_user: byMonth(unmapped),
      },
    };

    // 6) delete モード: orphan を GymBoard から物理削除
    const deleteResults: Array<Record<string, unknown>> = [];
    if (doDelete) {
      for (const o of orphans) {
        const { error: delErr } = await admin
          .from("bookings")
          .delete()
          .eq("id", o.id)
          .eq("tenant_id", TENANT_ID)
          .eq("source", "salute_sync");
        deleteResults.push({
          id: o.id,
          user_id: o.user_id,
          booking_date: o.booking_date,
          status: o.status,
          deleted: !delErr,
          error: delErr?.message ?? null,
        });
      }
    }

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      from_date: FROM_DATE,
      mode: doDelete ? "delete" : "report_only",
      counts,
      orphans,
      unmapped,
      delete_results: deleteResults,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
