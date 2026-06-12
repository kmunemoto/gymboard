// GymBoard 側: Salute の通常予約 (bookings) の INSERT/UPDATE/DELETE を
// リアルタイム受信し、テナント ceda19b0-... に反映する。
// - x-migration-secret ヘッダで認証 (MIGRATION_SHARED_SECRET と一致必須)
// - user_id は migration_user_map で salute_user_id → gymboard_user_id 変換
// - 未マップユーザーは skipped_unmapped_user
// - check_booking_overlap で拒否された INSERT は skipped_overlap
// - エラーも 200 + ok:false で返す (呼び出し元 fire-and-forget)
// - service_role で実行 (RLS 回避)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-migration-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

function json(body: unknown, status: number) {
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

type SaluteBookingRow = {
  id?: string;
  user_id?: string;
  booking_date?: string;
  booking_type?: string | null;
  status?: string | null;
  google_event_id?: string | null;
  created_at?: string | null;
};

type Payload = {
  op?: "INSERT" | "UPDATE" | "DELETE";
  old?: SaluteBookingRow | null;
  new?: SaluteBookingRow | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!SHARED_SECRET) {
      return json({ ok: false, error: "Server misconfigured: MIGRATION_SHARED_SECRET missing" }, 500);
    }

    const provided = req.headers.get("x-migration-secret") ?? "";
    if (provided !== SHARED_SECRET) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const op = body.op;
    if (op !== "INSERT" && op !== "UPDATE" && op !== "DELETE") {
      return json({ ok: false, error: "op must be INSERT|UPDATE|DELETE" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Salute側 user_id を解決 (INSERT/UPDATE は new.user_id 優先、DELETE は old.user_id)
    const primaryRow = op === "DELETE" ? body.old : (body.new ?? body.old);
    const saluteUserId = primaryRow?.user_id;
    if (!saluteUserId) {
      return json({ ok: false, error: "user_id missing in payload" }, 400);
    }

    const { data: mapped, error: mapErr } = await admin
      .from("migration_user_map")
      .select("gymboard_user_id")
      .eq("tenant_id", TENANT_ID)
      .eq("salute_user_id", saluteUserId)
      .maybeSingle();
    if (mapErr) {
      return json({ ok: false, error: `user map lookup failed: ${mapErr.message}` }, 200);
    }
    if (!mapped?.gymboard_user_id) {
      return json({ ok: true, action: "skipped_unmapped_user", salute_user_id: saluteUserId }, 200);
    }
    const gymboardUserId = mapped.gymboard_user_id as string;

    // ---- INSERT ----
    if (op === "INSERT") {
      const n = body.new ?? {};
      if (!n.booking_date) return json({ ok: false, error: "new.booking_date required" }, 400);

      const { data: existing, error: dupErr } = await admin
        .from("bookings")
        .select("id")
        .eq("tenant_id", TENANT_ID)
        .eq("user_id", gymboardUserId)
        .eq("booking_date", n.booking_date)
        .maybeSingle();
      if (dupErr) return json({ ok: false, error: `duplicate check failed: ${dupErr.message}` }, 200);
      if (existing) {
        return json({ ok: true, action: "skipped_duplicate", booking_id: existing.id }, 200);
      }

      const insertRow: Record<string, unknown> = {
        tenant_id: TENANT_ID,
        user_id: gymboardUserId,
        booking_date: n.booking_date,
        booking_type: normalizeBookingType(n.booking_type ?? null),
        status: n.status ?? "confirmed",
        google_event_id: n.google_event_id ?? null,
      };
      if (n.created_at) insertRow.created_at = n.created_at;

      const { data: inserted, error: insErr } = await admin
        .from("bookings")
        .insert(insertRow)
        .select("id")
        .single();

      if (insErr) {
        const msg = insErr.message ?? "";
        const isOverlap = /overlap/i.test(msg) || /check_booking_overlap/i.test(msg) || /conflict/i.test(msg);
        if (isOverlap) {
          return json({ ok: true, action: "skipped_overlap", reason: msg }, 200);
        }
        return json({ ok: false, error: `insert failed: ${msg}`, code: insErr.code }, 200);
      }

      return json({ ok: true, action: "inserted", booking_id: inserted?.id ?? null }, 200);
    }

    // ---- UPDATE ----
    if (op === "UPDATE") {
      const o = body.old ?? {};
      const n = body.new ?? {};
      if (!o.booking_date) return json({ ok: false, error: "old.booking_date required" }, 400);
      if (!n.booking_date) return json({ ok: false, error: "new.booking_date required" }, 400);

      const { data: target, error: findErr } = await admin
        .from("bookings")
        .select("id")
        .eq("tenant_id", TENANT_ID)
        .eq("user_id", gymboardUserId)
        .eq("booking_date", o.booking_date)
        .maybeSingle();
      if (findErr) return json({ ok: false, error: `find failed: ${findErr.message}` }, 200);

      // フォールバック: 見つからなければ INSERT として処理
      if (!target) {
        const { data: dup } = await admin
          .from("bookings")
          .select("id")
          .eq("tenant_id", TENANT_ID)
          .eq("user_id", gymboardUserId)
          .eq("booking_date", n.booking_date)
          .maybeSingle();
        if (dup) {
          return json({ ok: true, action: "skipped_duplicate", booking_id: dup.id }, 200);
        }
        const insertRow: Record<string, unknown> = {
          tenant_id: TENANT_ID,
          user_id: gymboardUserId,
          booking_date: n.booking_date,
          booking_type: normalizeBookingType(n.booking_type ?? null),
          status: n.status ?? "confirmed",
          google_event_id: n.google_event_id ?? null,
        };
        if (n.created_at) insertRow.created_at = n.created_at;
        const { data: inserted, error: insErr } = await admin
          .from("bookings")
          .insert(insertRow)
          .select("id")
          .single();
        if (insErr) {
          const msg = insErr.message ?? "";
          const isOverlap = /overlap/i.test(msg) || /check_booking_overlap/i.test(msg) || /conflict/i.test(msg);
          if (isOverlap) return json({ ok: true, action: "skipped_overlap", reason: msg }, 200);
          return json({ ok: false, error: `update->insert failed: ${msg}`, code: insErr.code }, 200);
        }
        return json({ ok: true, action: "inserted", booking_id: inserted?.id ?? null, fallback: true }, 200);
      }

      const updateRow: Record<string, unknown> = {
        booking_date: n.booking_date,
        booking_type: normalizeBookingType(n.booking_type ?? null),
        status: n.status ?? "confirmed",
      };
      const { error: updErr } = await admin
        .from("bookings")
        .update(updateRow)
        .eq("id", target.id);
      if (updErr) {
        const msg = updErr.message ?? "";
        const isOverlap = /overlap/i.test(msg) || /check_booking_overlap/i.test(msg) || /conflict/i.test(msg);
        if (isOverlap) return json({ ok: true, action: "skipped_overlap", reason: msg }, 200);
        return json({ ok: false, error: `update failed: ${msg}`, code: updErr.code }, 200);
      }
      return json({ ok: true, action: "updated", booking_id: target.id }, 200);
    }

    // ---- DELETE ----
    if (op === "DELETE") {
      const o = body.old ?? {};
      if (!o.booking_date) return json({ ok: false, error: "old.booking_date required" }, 400);

      const { data: target, error: findErr } = await admin
        .from("bookings")
        .select("id")
        .eq("tenant_id", TENANT_ID)
        .eq("user_id", gymboardUserId)
        .eq("booking_date", o.booking_date)
        .maybeSingle();
      if (findErr) return json({ ok: false, error: `find failed: ${findErr.message}` }, 200);
      if (!target) {
        return json({ ok: true, action: "skipped_not_found" }, 200);
      }
      const { error: delErr } = await admin.from("bookings").delete().eq("id", target.id);
      if (delErr) return json({ ok: false, error: `delete failed: ${delErr.message}` }, 200);
      return json({ ok: true, action: "deleted", booking_id: target.id }, 200);
    }

    return json({ ok: false, error: "unreachable" }, 500);
  } catch (e) {
    const err = e as { message?: string };
    return json({ ok: false, error: err.message ?? String(e) }, 200);
  }
});
