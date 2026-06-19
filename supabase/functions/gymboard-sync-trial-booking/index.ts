// GymBoard 側: Salute の体験予約フォームから新規体験予約を受信し、
// trial_bookings に tenant_id 付きで INSERT する。
// - x-migration-secret ヘッダで認証 (MIGRATION_SHARED_SECRET と一致必須)
// - 冪等性: (tenant_id, booking_date, guest_name) で重複チェック → skip
// - check_booking_overlap トリガで拒否された場合もエラーではなく skipped_overlap
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

type Payload = {
  guest_name?: string;
  guest_contact?: string;
  booking_date?: string;
  booking_type?: string;
  status?: string;
  google_event_id?: string | null;
  created_at?: string | null;
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

    const guest_name = (body.guest_name ?? "").trim();
    const guest_contact = (body.guest_contact ?? "").trim();
    const booking_date = (body.booking_date ?? "").trim();
    if (!guest_name || !guest_contact || !booking_date) {
      return json({ ok: false, error: "guest_name, guest_contact, booking_date are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 冪等性チェック: 同 tenant + 同日時 + 同 guest_name は二重投入しない
    const { data: existing, error: dupErr } = await admin
      .from("trial_bookings")
      .select("id")
      .eq("tenant_id", TENANT_ID)
      .eq("booking_date", booking_date)
      .eq("guest_name", guest_name)
      .maybeSingle();
    if (dupErr) {
      return json({ ok: false, error: `duplicate check failed: ${dupErr.message}` }, 500);
    }
    if (existing) {
      return json({
        ok: true,
        action: "skipped_duplicate",
        trial_booking_id: existing.id,
        tenant_id: TENANT_ID,
        booking_date,
        guest_name,
      }, 200);
    }

    const insertRow: Record<string, unknown> = {
      tenant_id: TENANT_ID,
      guest_name,
      guest_contact,
      booking_date,
      booking_type: body.booking_type ?? "trial",
      status: body.status ?? "confirmed",
      google_event_id: body.google_event_id ?? null,
    };
    if (body.created_at) insertRow.created_at = body.created_at;

    const { data: inserted, error: insErr } = await admin
      .from("trial_bookings")
      .insert(insertRow)
      .select("id")
      .single();

    if (insErr) {
      // check_booking_overlap トリガ等で拒否された場合は skipped_overlap として扱う
      const msg = insErr.message ?? "";
      const isOverlap =
        /overlap/i.test(msg) ||
        /check_booking_overlap/i.test(msg) ||
        /conflict/i.test(msg);
      if (isOverlap) {
        return json({
          ok: true,
          action: "skipped_overlap",
          reason: msg,
          tenant_id: TENANT_ID,
          booking_date,
          guest_name,
        }, 200);
      }
      return json({ ok: false, error: `insert failed: ${msg}`, code: insErr.code }, 500);
    }

    // 体験予約が入ったことをトレーナーにプッシュ通知(fire-and-forget)
    const newTrialId = inserted?.id;
    if (newTrialId) {
      try {
        const pushRes = await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SERVICE_ROLE,
            "Authorization": `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({
            purpose: "trial_booking",
            trial_booking_id: newTrialId,
          }),
        });
        const pushText = await pushRes.text();
        console.log(`[trial-push] status=${pushRes.status} body=${pushText}`);
      } catch (e) {
        console.error("[trial-push] failed:", e instanceof Error ? e.message : String(e));
      }
    }

    return json({
      ok: true,
      action: "inserted",
      trial_booking_id: inserted?.id ?? null,
      tenant_id: TENANT_ID,
      booking_date,
      guest_name,
    }, 200);
  } catch (e) {
    const err = e as { message?: string };
    return json({ ok: false, error: err.message ?? String(e) }, 500);
  }
});
