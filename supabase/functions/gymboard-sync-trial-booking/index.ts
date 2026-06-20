// GymBoard 側: Salute の体験予約フォームから新規体験予約を受信し、
// trial_bookings に tenant_id 付きで INSERT する。
// - x-migration-secret ヘッダで認証 (MIGRATION_SHARED_SECRET と一致必須)
// - 冪等性: (tenant_id, booking_date, guest_name) で重複チェック → skip
// - check_booking_overlap トリガで拒否された場合もエラーではなく skipped_overlap
// - service_role で実行 (RLS 回避)
// - 2026-07-01 より前の予約日は GymBoard 側に同期しない（Salute側で運用継続のため）
//   ただし、メール通知・push 通知は同期可否に関わらず必ず送る。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-migration-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";
const SYNC_CUTOFF = "2026-07-01T00:00:00+09:00"; // これより前の体験予約は同期しない

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

    // ===== 同期処理（カットオフ前は skip）=====
    const shouldSync = new Date(booking_date).getTime() >= new Date(SYNC_CUTOFF).getTime();
    let syncAction: string = "inserted";
    let trialIdForLog: string | null = null;
    let syncError: { message: string; code?: string } | null = null;

    if (!shouldSync) {
      syncAction = "skipped_pre_cutoff";
      console.log(`[trial-sync] skipped_pre_cutoff booking_date=${booking_date}`);
    } else {
      // 冪等性チェック: 同 tenant + 同日時 + 同 guest_name は二重投入しない
      const { data: existing, error: dupErr } = await admin
        .from("trial_bookings")
        .select("id")
        .eq("tenant_id", TENANT_ID)
        .eq("booking_date", booking_date)
        .eq("guest_name", guest_name)
        .maybeSingle();

      if (dupErr) {
        syncError = { message: `duplicate check failed: ${dupErr.message}` };
        syncAction = "sync_error";
      } else if (existing) {
        syncAction = "skipped_duplicate";
        trialIdForLog = existing.id;
      } else {
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
          const msg = insErr.message ?? "";
          const isOverlap =
            /overlap/i.test(msg) ||
            /check_booking_overlap/i.test(msg) ||
            /conflict/i.test(msg);
          if (isOverlap) {
            syncAction = "skipped_overlap";
          } else {
            syncError = { message: `insert failed: ${msg}`, code: insErr.code };
            syncAction = "sync_error";
          }
        } else {
          syncAction = "inserted";
          trialIdForLog = inserted?.id ?? null;
        }
      }
    }

    // ===== 通知処理（同期可否に関わらず必ず実行）=====
    // idempotencyKey は insert の有無に依存しない安定キーを使う
    const safeContact = guest_contact.replace(/[^A-Za-z0-9._@+-]/g, "_");
    const notifyKey = `${booking_date}-${safeContact}`;

    // push 通知（trial_booking_id が無い場合はスキップ：push は record 起点）
    if (trialIdForLog) {
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
            trial_booking_id: trialIdForLog,
          }),
        });
        const pushText = await pushRes.text();
        console.log(`[trial-push] status=${pushRes.status} body=${pushText}`);
      } catch (e) {
        console.error("[trial-push] failed:", e instanceof Error ? e.message : String(e));
      }
    } else {
      console.log("[trial-push] skip (no trial_booking_id; pre-cutoff or skipped)");
    }

    // メール通知 (fire-and-forget)
    try {
      const jstOffset = 9 * 60 * 60 * 1000;
      const dowChars = ["日", "月", "火", "水", "木", "金", "土"];
      const bd = new Date(booking_date);
      const jstBd = new Date(bd.getTime() + jstOffset);
      const dateStr = `${jstBd.getUTCMonth() + 1}月${jstBd.getUTCDate()}日（${dowChars[jstBd.getUTCDay()]}）`;
      const startMin = jstBd.getUTCHours() * 60 + jstBd.getUTCMinutes();
      const endMin = startMin + 60;
      const fmt = (m: number) =>
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const timeStr = `${fmt(startMin)}〜${fmt(endMin)}`;

      const invokeEmail = async (payload: Record<string, unknown>) => {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SERVICE_ROLE,
            "Authorization": `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify(payload),
        });
        const t = await res.text();
        console.log(`[trial-email] template=${payload.templateName} status=${res.status} body=${t}`);
      };

      // 1) お客様宛 (guest_contact がメールアドレスの場合のみ)
      if (guest_contact.includes("@")) {
        invokeEmail({
          templateName: "trial-booking-confirmation",
          recipientEmail: guest_contact,
          idempotencyKey: `trial-confirm-${notifyKey}`,
          templateData: {
            customerName: guest_name,
            bookingDate: dateStr,
            bookingTime: timeStr,
          },
        }).catch((e) =>
          console.error("[trial-email] customer failed:", e instanceof Error ? e.message : String(e)),
        );
      } else {
        console.log("[trial-email] skip customer (guest_contact is not email)");
      }

      // 2) トレーナー宛
      try {
        const { data: trainerRoles } = await admin.rpc("get_trainer_ids");
        const trainerId = (trainerRoles as Array<{ user_id: string }> | null)?.[0]?.user_id;
        if (trainerId) {
          invokeEmail({
            templateName: "new-booking-notification",
            recipientEmail: "_resolve_trainer_",
            idempotencyKey: `trial-notify-${notifyKey}`,
            templateData: {
              customerName: `${guest_name}（初回無料体験）`,
              bookingDate: dateStr,
              bookingTime: timeStr,
              planName: "初回無料体験",
              dashboardUrl: "https://gymboard.lovable.app",
              trainerUserId: trainerId,
            },
          }).catch((e) =>
            console.error("[trial-email] trainer failed:", e instanceof Error ? e.message : String(e)),
          );
        } else {
          console.log("[trial-email] no trainer found via get_trainer_ids");
        }
      } catch (e) {
        console.error("[trial-email] trainer resolve failed:", e instanceof Error ? e.message : String(e));
      }
    } catch (e) {
      console.error("[trial-email] failed:", e instanceof Error ? e.message : String(e));
    }

    // ===== レスポンス =====
    if (syncError) {
      // 同期は失敗したがメール送信は試行済み
      return json({
        ok: false,
        action: syncAction,
        error: syncError.message,
        code: syncError.code,
        tenant_id: TENANT_ID,
        booking_date,
        guest_name,
        notified: true,
      }, 500);
    }

    return json({
      ok: true,
      action: syncAction,
      trial_booking_id: trialIdForLog,
      tenant_id: TENANT_ID,
      booking_date,
      guest_name,
      notified: true,
    }, 200);
  } catch (e) {
    const err = e as { message?: string };
    return json({ ok: false, error: err.message ?? String(e) }, 500);
  }
});
