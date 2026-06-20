// diag-booking-reconcile
// GymBoard 側 bookings(source IS NULL, 2026-06-01 以降) と Salute 側 bookings を突合し、
// 「Salute にも存在する」「GymBoard にしかない」「判定不能」に分類するレポートを返す。
// 読み取り専用。データは一切変更しない。
//
// 環境変数:
//   - MIGRATION_SHARED_SECRET (Salute 側との共有シークレット)
//   - SALUTE_BOOKINGS_URL or SALUTE_EXPORT_URL (派生)
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (自動注入)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

// 日時を秒単位の ISO 文字列に正規化（タイムゾーン差・ミリ秒差を吸収）
function normalizeDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

type GbBooking = {
  id: string;
  user_id: string;
  booking_date: string;
  booking_type: string | null;
  status: string | null;
  google_event_id: string | null;
  created_at: string | null;
};

type SaluteBooking = {
  id?: string;
  user_id: string;
  booking_date: string;
  booking_type?: string | null;
  status?: string | null;
  google_event_id?: string | null;
  created_at?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SHARED_SECRET) {
      return json({ ok: false, error: "MIGRATION_SHARED_SECRET missing" }, 500);
    }

    let SALUTE_BOOKINGS_URL = Deno.env.get("SALUTE_BOOKINGS_URL");
    if (!SALUTE_BOOKINGS_URL) {
      const base = Deno.env.get("SALUTE_EXPORT_URL");
      if (base) {
        SALUTE_BOOKINGS_URL = base
          .replace("salute-export-counts", "salute-export-bookings")
          .replace("salute-export-customers", "salute-export-bookings")
          .replace("salute-export-measurements", "salute-export-bookings")
          .replace("salute-export-goals", "salute-export-bookings")
          .replace("salute-export-exercises", "salute-export-bookings");
      }
    }
    if (!SALUTE_BOOKINGS_URL) {
      return json({ ok: false, error: "SALUTE_BOOKINGS_URL or SALUTE_EXPORT_URL must be set" }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) GymBoard: source IS NULL の保留分を取得（2026-06-01 以降）
    const { data: gbRows, error: gbErr } = await admin
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, status, google_event_id, created_at")
      .eq("tenant_id", TENANT_ID)
      .is("source", null)
      .gte("booking_date", FROM_DATE)
      .order("booking_date");
    if (gbErr) return json({ ok: false, step: "fetch_gymboard", error: gbErr.message }, 200);
    const gymboardBookings = (gbRows ?? []) as GbBooking[];

    // 2) Salute: 同期間の予約を取得
    const url = new URL(SALUTE_BOOKINGS_URL);
    url.searchParams.set("from", FROM_DATE);
    const saluteRes = await fetch(url.toString(), {
      method: "GET",
      headers: { "x-migration-secret": SHARED_SECRET },
    });
    const saluteText = await saluteRes.text();
    if (!saluteRes.ok) {
      return json({
        ok: false,
        step: "fetch_salute",
        status: saluteRes.status,
        body: saluteText.slice(0, 500),
      }, 200);
    }
    let salutePayload: unknown;
    try {
      salutePayload = JSON.parse(saluteText);
    } catch {
      return json({ ok: false, step: "parse_salute", body: saluteText.slice(0, 500) }, 200);
    }
    const saluteBookings: SaluteBooking[] = Array.isArray(salutePayload)
      ? (salutePayload as SaluteBooking[])
      : Array.isArray((salutePayload as { bookings?: SaluteBooking[] }).bookings)
        ? (salutePayload as { bookings: SaluteBooking[] }).bookings
        : Array.isArray((salutePayload as { data?: SaluteBooking[] }).data)
          ? (salutePayload as { data: SaluteBooking[] }).data
          : [];

    // 3) migration_user_map: GymBoard 関連ユーザーの対応表
    const gbUserIds = Array.from(new Set(gymboardBookings.map((b) => b.user_id)));
    const { data: mapRows, error: mapErr } = await admin
      .from("migration_user_map")
      .select("gymboard_user_id, salute_user_id")
      .eq("tenant_id", TENANT_ID)
      .in("gymboard_user_id", gbUserIds.length > 0 ? gbUserIds : ["00000000-0000-0000-0000-000000000000"]);
    if (mapErr) return json({ ok: false, step: "fetch_map", error: mapErr.message }, 200);
    const gb2salute = new Map<string, string>();
    for (const r of mapRows ?? []) {
      if (r.gymboard_user_id && r.salute_user_id) {
        gb2salute.set(r.gymboard_user_id as string, r.salute_user_id as string);
      }
    }

    // 4) Salute 側を (salute_user_id|normalized_date) でインデックス化（cancelled は除外）
    const saluteIndex = new Map<string, SaluteBooking[]>();
    for (const sb of saluteBookings) {
      if (!sb.user_id || !sb.booking_date) continue;
      const status = (sb.status ?? "").toString();
      if (status === "cancelled" || status === "キャンセル") continue;
      const nd = normalizeDate(sb.booking_date);
      if (!nd) continue;
      const key = `${sb.user_id}|${nd}`;
      const arr = saluteIndex.get(key) ?? [];
      arr.push(sb);
      saluteIndex.set(key, arr);
    }

    // 5) 突合
    const onlyInGymboard: Array<GbBooking & { month: string }> = [];
    const alsoInSalute: Array<GbBooking & { month: string; salute_match_count: number }> = [];
    const unmappedUser: Array<GbBooking & { month: string }> = [];

    for (const gb of gymboardBookings) {
      const month = monthKey(gb.booking_date);
      const saluteUserId = gb2salute.get(gb.user_id);
      if (!saluteUserId) {
        unmappedUser.push({ ...gb, month });
        continue;
      }
      const nd = normalizeDate(gb.booking_date);
      const key = `${saluteUserId}|${nd}`;
      const matches = saluteIndex.get(key) ?? [];
      if (matches.length > 0) {
        alsoInSalute.push({ ...gb, month, salute_match_count: matches.length });
      } else {
        onlyInGymboard.push({ ...gb, month });
      }
    }

    const countByMonth = (rows: Array<{ month: string }>): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const r of rows) out[r.month] = (out[r.month] ?? 0) + 1;
      return out;
    };

    return json({
      ok: true,
      readonly: true,
      tenant_id: TENANT_ID,
      from_date: FROM_DATE,
      counts: {
        gymboard_pending_total: gymboardBookings.length,
        salute_fetched_total: saluteBookings.length,
        only_in_gymboard: onlyInGymboard.length,
        also_in_salute: alsoInSalute.length,
        unmapped_user: unmappedUser.length,
      },
      only_in_gymboard_by_month: countByMonth(onlyInGymboard),
      also_in_salute_by_month: countByMonth(alsoInSalute),
      unmapped_user_by_month: countByMonth(unmappedUser),
      only_in_gymboard: onlyInGymboard.map((b) => ({
        id: b.id,
        user_id: b.user_id,
        booking_date: b.booking_date,
        booking_type: b.booking_type,
        status: b.status,
        month: b.month,
        created_at: b.created_at,
      })),
      also_in_salute: alsoInSalute.map((b) => ({
        id: b.id,
        user_id: b.user_id,
        booking_date: b.booking_date,
        booking_type: b.booking_type,
        status: b.status,
        month: b.month,
        salute_match_count: b.salute_match_count,
      })),
      unmapped_user: unmappedUser.map((b) => ({
        id: b.id,
        user_id: b.user_id,
        booking_date: b.booking_date,
        month: b.month,
      })),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
