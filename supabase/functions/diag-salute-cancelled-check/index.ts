// diag-salute-cancelled-check
// 1) GymBoard side: source='gymboard' bookings (2026-06-01+, tenant ceda19b0).
// 2) Salute side: salute-export-bookings (試行: include_cancelled=true, status=all, with_cancelled=true).
//    返却データに cancelled が含まれるかも検証する。
// 3) 各 GymBoard 予約に対する Salute 側の status を突合し、
//    Salute 側が cancelled のものを列挙。
// 4) ?fix=1 (POST) の場合、Salute cancelled に該当する GymBoard 予約に対し:
//    - sync-booking-from-gymboard に action:'delete' を送信し external_bookings から削除
//    - GymBoard 側 bookings.status='cancelled', source='salute_sync' に更新（再送防止 + 実体反映）
// 読み取り専用がデフォルト。?fix=1 でのみ変更。

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

function isCancelledStatus(s: unknown): boolean {
  const v = String(s ?? "");
  return v === "cancelled" || v === "キャンセル" || v === "キャンセル済み" || v === "canceled";
}

type GbBooking = {
  id: string;
  user_id: string;
  booking_date: string;
  booking_type: string | null;
  status: string | null;
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
    const fix = url.searchParams.get("fix") === "1" && req.method === "POST";
    const allDelete = url.searchParams.get("all_delete") === "1" && req.method === "POST";

    const saluteBase = SALUTE_URL_BASE.replace(/\/$/, "");
    const exportUrl = `${saluteBase}/functions/v1/salute-export-bookings`;
    const syncUrl = `${saluteBase}/functions/v1/sync-booking-from-gymboard`;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) GymBoard 由来の20件 (source='gymboard') を取得
    const { data: gbRows, error: gbErr } = await admin
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, status")
      .eq("tenant_id", TENANT_ID)
      .eq("source", "gymboard")
      .gte("booking_date", FROM_DATE)
      .order("booking_date");
    if (gbErr) return json({ ok: false, step: "fetch_gb", error: gbErr.message }, 200);
    const gbBookings = (gbRows ?? []) as GbBooking[];

    // 2) Salute: 複数パラメータを試して cancelled を含む応答を取得
    const variants = [
      "?from=2026-06-01&include_cancelled=true",
      "?from=2026-06-01&status=all",
      "?from=2026-06-01&with_cancelled=true",
      "?from=2026-06-01&all_status=true",
      "?from=2026-06-01",
    ];
    const attempts: Array<{ variant: string; total: number; cancelled_count: number }> = [];
    let chosen: SaluteBooking[] = [];
    let chosenVariant = "";
    for (const v of variants) {
      const res = await fetch(exportUrl + v, {
        method: "GET",
        headers: { "x-migration-secret": SHARED_SECRET },
      });
      if (!res.ok) {
        attempts.push({ variant: v, total: -1, cancelled_count: -1 });
        continue;
      }
      const txt = await res.text();
      let payload: unknown;
      try { payload = JSON.parse(txt); } catch { continue; }
      const arr: SaluteBooking[] = Array.isArray(payload)
        ? (payload as SaluteBooking[])
        : Array.isArray((payload as { bookings?: SaluteBooking[] }).bookings)
          ? (payload as { bookings: SaluteBooking[] }).bookings
          : Array.isArray((payload as { data?: SaluteBooking[] }).data)
            ? (payload as { data: SaluteBooking[] }).data
            : [];
      const cc = arr.filter((b) => isCancelledStatus(b.status)).length;
      attempts.push({ variant: v, total: arr.length, cancelled_count: cc });
      if (cc > chosen.filter((b) => isCancelledStatus(b.status)).length) {
        chosen = arr;
        chosenVariant = v;
      } else if (chosen.length === 0) {
        chosen = arr;
        chosenVariant = v;
      }
    }

    // 3) user 対応
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

    // 4) Salute インデックス (全status保持)
    type SIdx = { active: SaluteBooking[]; cancelled: SaluteBooking[] };
    const saluteIndex = new Map<string, SIdx>();
    for (const sb of chosen) {
      if (!sb.user_id || !sb.booking_date) continue;
      const nd = normalizeDate(sb.booking_date);
      if (!nd) continue;
      const key = `${sb.user_id}|${nd}`;
      const entry = saluteIndex.get(key) ?? { active: [], cancelled: [] };
      if (isCancelledStatus(sb.status)) entry.cancelled.push(sb);
      else entry.active.push(sb);
      saluteIndex.set(key, entry);
    }

    // 5) 突合
    type Row = GbBooking & {
      salute_user_id: string | null;
      salute_active: number;
      salute_cancelled: number;
      classification: string;
    };
    const classified: Row[] = [];
    for (const b of gbBookings) {
      const su = gb2salute.get(b.user_id) ?? null;
      const nd = normalizeDate(b.booking_date);
      const entry = su && nd ? (saluteIndex.get(`${su}|${nd}`) ?? { active: [], cancelled: [] }) : { active: [], cancelled: [] };
      let cls = "only_in_gymboard";
      if (!su) cls = "unmapped_user";
      else if (entry.active.length > 0) cls = "salute_active";
      else if (entry.cancelled.length > 0) cls = "salute_cancelled";
      classified.push({
        ...b,
        salute_user_id: su,
        salute_active: entry.active.length,
        salute_cancelled: entry.cancelled.length,
        classification: cls,
      });
    }

    const counts = {
      total: classified.length,
      only_in_gymboard: classified.filter((r) => r.classification === "only_in_gymboard").length,
      salute_active: classified.filter((r) => r.classification === "salute_active").length,
      salute_cancelled: classified.filter((r) => r.classification === "salute_cancelled").length,
      unmapped_user: classified.filter((r) => r.classification === "unmapped_user").length,
    };

    // 6) fix モード: salute_cancelled に該当する GymBoard 予約を処理
    const fixResults: Array<Record<string, unknown>> = [];
    if (fix || allDelete) {
      const targets = allDelete
        ? classified
        : classified.filter((r) => r.classification === "salute_cancelled");
      for (const t of targets) {
        // 6a) delete を Salute へ送信 (external_bookings から消す)
        const payload = {
          gymboard_booking_id: t.id,
          salute_user_id: t.salute_user_id,
          booking_date: t.booking_date,
          booking_type: t.booking_type,
          status: "cancelled",
          action: "delete",
        };
        let deleteOk = false;
        let deleteResp = "";
        try {
          const res = await fetch(syncUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-migration-secret": SHARED_SECRET,
            },
            body: JSON.stringify(payload),
          });
          deleteResp = (await res.text()).slice(0, 200);
          deleteOk = res.ok;
        } catch (e) {
          deleteResp = e instanceof Error ? e.message : String(e);
        }

        // 6b) GymBoard 側の status/source を補正
        // 6b) GymBoard 側 source を NULL に戻す（all_delete モード）／cancelled+salute_sync 補正（fix モード）
        const updatePayload = allDelete
          ? { source: null as unknown as string }
          : { status: "cancelled", source: "salute_sync" };
        const { error: upErr } = await admin
          .from("bookings")
          .update(updatePayload)
          .eq("id", t.id)
          .eq("tenant_id", TENANT_ID);

        fixResults.push({
          id: t.id,
          booking_date: t.booking_date,
          delete_sent: deleteOk,
          delete_response: deleteResp,
          gb_update_error: upErr?.message ?? null,
        });
      }
    }

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      mode: allDelete ? "all_delete" : fix ? "fix" : "report_only",
      salute_export_attempts: attempts,
      salute_export_chosen_variant: chosenVariant,
      salute_total_used: chosen.length,
      counts,
      classified,
      fix_results: fixResults,
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
