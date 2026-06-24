// sync-trial-cancel-to-salute
// トレーナーが GymBoard で体験予約をキャンセルした直後に呼ばれ、その場で
//   (1) Salute へキャンセルを伝え（予約サイトの枠を即時解放）
//   (2) お客様とジム(トレーナー)へキャンセル確認メールを送る
// を行う「即時版」のキャンセル後処理。
// (1時間ごとの sync-bookings-to-salute バッチは Salute 反映の安全網として残る)
//
// - クライアント(トレーナー)から supabase.functions.invoke で呼ばれる。
// - 念のため GymBoard 側に「キャンセル済み」の該当行が実在することを確認してから
//   処理する (任意の予約を外部から勝手にキャンセル/通知させないため)。
// - メールは冪等キー付き。二重invokeでも重複送信しない。
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
    // 実在するキャンセルのみを処理する (なりすまし防止 & 冪等)。guest_contact も取得。
    const { data: gbRow, error: gbErr } = await admin
      .from("trial_bookings")
      .select("id, guest_contact")
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
    const guest_contact = (gbRow.guest_contact as string | null) ?? "";

    // ===== (1) Salute へキャンセルを伝える =====
    let saluteOk = false;
    let saluteStatus = 0;
    try {
      const targetUrl = `${SALUTE_URL_BASE.replace(/\/$/, "")}/functions/v1/sync-trial-booking-from-gymboard`;
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-migration-secret": SHARED_SECRET },
        body: JSON.stringify({ booking_date, guest_name, action: "cancel" }),
      });
      saluteStatus = res.status;
      saluteOk = res.ok;
      const txt = await res.text();
      console.log(`[trial-cancel-realtime] salute status=${res.status} body=${txt.slice(0, 200)}`);
    } catch (e) {
      console.error("[trial-cancel-realtime] salute sync failed:", e instanceof Error ? e.message : String(e));
    }

    // ===== (2) キャンセル確認メール (お客様 + ジム) =====
    const safeContact = guest_contact.replace(/[^A-Za-z0-9._@+-]/g, "_");
    const notifyKey = `${booking_date}-${safeContact}`;

    const jstOffset = 9 * 60 * 60 * 1000;
    const dowChars = ["日", "月", "火", "水", "木", "金", "土"];
    const bd = new Date(booking_date);
    const jstBd = new Date(bd.getTime() + jstOffset);
    const dateStr = `${jstBd.getUTCMonth() + 1}月${jstBd.getUTCDate()}日（${dowChars[jstBd.getUTCDay()]}）`;
    const startMin = jstBd.getUTCHours() * 60 + jstBd.getUTCMinutes();
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const timeStr = `${fmt(startMin)}〜${fmt(startMin + 60)}`;

    const invokeEmail = (payload: Record<string, unknown>) =>
      fetch(`${SUPABASE_URL}/functions/v1/send-transactional-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SERVICE_ROLE,
          "Authorization": `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify(payload),
      })
        .then((r) => r.text())
        .then((t) => console.log(`[trial-cancel-email] template=${payload.templateName} body=${t.slice(0, 160)}`))
        .catch((e) => console.error("[trial-cancel-email] failed:", e instanceof Error ? e.message : String(e)));

    // お客様宛
    if (guest_contact.includes("@")) {
      await invokeEmail({
        templateName: "booking-cancellation",
        recipientEmail: guest_contact,
        idempotencyKey: `trial-cancel-customer-${notifyKey}`,
        templateData: {
          customerName: guest_name,
          bookingDate: dateStr,
          bookingTime: timeStr,
          planName: "初回無料体験",
          recipientRole: "customer",
          isTrial: true,
        },
      });
    }

    // ジム(トレーナー)宛
    try {
      const { data: trainerRoles } = await admin.rpc("get_trainer_ids");
      const trainerId = (trainerRoles as Array<{ user_id: string }> | null)?.[0]?.user_id;
      if (trainerId) {
        await invokeEmail({
          templateName: "booking-cancellation",
          recipientEmail: "_resolve_trainer_",
          idempotencyKey: `trial-cancel-trainer-${notifyKey}`,
          templateData: {
            customerName: guest_name,
            bookingDate: dateStr,
            bookingTime: timeStr,
            planName: "初回無料体験",
            recipientRole: "trainer",
            isTrial: true,
            trainerUserId: trainerId,
          },
        });
      } else {
        console.log("[trial-cancel-email] no trainer found via get_trainer_ids");
      }
    } catch (e) {
      console.error("[trial-cancel-email] trainer resolve failed:", e instanceof Error ? e.message : String(e));
    }

    return json({ ok: true, salute_synced: saluteOk, salute_status: saluteStatus, notified: true }, 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
