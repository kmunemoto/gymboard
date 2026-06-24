// sync-trial-cancel-to-salute
// トレーナーが GymBoard で体験予約をキャンセルした直後に呼ばれ、その場で
// Salute へキャンセルを伝える「即時版」逆同期。
// (1時間ごとの sync-bookings-to-salute バッチは安全網として引き続き残す)
//
// - クライアント(トレーナー)から supabase.functions.invoke で呼ばれる。
// - 念のため GymBoard 側に「キャンセル済み」の該当行が実在することを確認してから
//   送信する (任意の予約を外部から勝手にキャンセルさせないため)。
// - Salute の sync-trial-booking-from-gymboard へ x-migration-secret 付きで送信。
// - 失敗してもバッチが後追いで再送するため致命的ではない (fire-and-forget 前提)。
//
// 環境変数:
//   - MIGRATION_SHARED_SECRET
//   - SALUTE_SUPABASE_URL
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (自動注入)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";
const CANCELLED = "キャンセル済み";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Payload = {
  booking_date?: string;
  guest_name?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SALUTE_URL_BASE = Deno.env.get("SALUTE_SUPABASE_URL");

    if (!SHARED_SECRET) return json({ ok: false, error: "MIGRATION_SHARED_SECRET missing" }, 500);
    if (!SALUTE_URL_BASE) return json({ ok: false, error: "SALUTE_SUPABASE_URL missing" }, 500);

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const booking_date = (body.booking_date ?? "").trim();
    const guest_name = (body.guest_name ?? "").trim();
    if (!booking_date || !guest_name) {
      return json({ ok: false, error: "booking_date and guest_name are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // GymBoard 側に「キャンセル済み」の該当予約が実在することを確認する。
    // 実在するキャンセルのみを Salute に伝える (なりすまし防止 & 冪等)。
    const { data: gbRow, error: gbErr } = await admin
      .from("trial_bookings")
      .select("id")
      .eq("tenant_id", TENANT_ID)
      .eq("booking_date", booking_date)
      .eq("guest_name", guest_name)
      .eq("status", CANCELLED)
      .limit(1)
      .maybeSingle();

    if (gbErr) return json({ ok: false, error: `verify failed: ${gbErr.message}` }, 500);
    if (!gbRow) {
      return json({ ok: false, error: "no matching cancelled trial in GymBoard" }, 409);
    }

    // Salute へキャンセルを伝える
    const targetUrl = `${SALUTE_URL_BASE.replace(/\/$/, "")}/functions/v1/sync-trial-booking-from-gymboard`;
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-migration-secret": SHARED_SECRET,
      },
      body: JSON.stringify({ booking_date, guest_name, action: "cancel" }),
    });
    const txt = await res.text();
    console.log(`[trial-cancel-realtime] status=${res.status} body=${txt.slice(0, 200)}`);

    return json({ ok: res.ok, salute_status: res.status, salute_response: txt.slice(0, 300) }, res.ok ? 200 : 502);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
