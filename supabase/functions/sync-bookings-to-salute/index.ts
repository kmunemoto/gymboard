// sync-bookings-to-salute
// GymBoard → Salute 一方向同期バッチ。
// テナント ceda19b0-d5e0-4928-ab2e-996a0b823af4 かつ source='gymboard' の bookings を
// Salute の sync-booking-from-gymboard へ送る (UPSERT、cancelled は delete)。
// 冪等。pg_cron から 1 時間に 1 回呼ばれる想定。verify_jwt=false / service_role。
//
// ループ防止: source='salute_sync' は対象外。source IS NULL も対象外。
//
// 環境変数:
//   - MIGRATION_SHARED_SECRET (Salute 側との共有シークレット)
//   - SALUTE_SUPABASE_URL  (https://<ref>.supabase.co)
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

function isCancelled(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = String(status);
  return s === "cancelled" || s === "キャンセル" || s === "キャンセル済み";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SHARED_SECRET = Deno.env.get("MIGRATION_SHARED_SECRET");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SALUTE_URL_BASE = Deno.env.get("SALUTE_SUPABASE_URL");

    if (!SHARED_SECRET) return json({ ok: false, error: "MIGRATION_SHARED_SECRET missing" }, 500);
    if (!SALUTE_URL_BASE) return json({ ok: false, error: "SALUTE_SUPABASE_URL missing" }, 500);

    const targetUrl = `${SALUTE_URL_BASE.replace(/\/$/, "")}/functions/v1/sync-booking-from-gymboard`;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // GymBoard 由来の予約を取得
    const { data: rows, error } = await admin
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, status")
      .eq("tenant_id", TENANT_ID)
      .eq("source", "gymboard")
      .gte("booking_date", FROM_DATE)
      .order("booking_date");
    if (error) return json({ ok: false, step: "fetch_bookings", error: error.message }, 200);

    const bookings = rows ?? [];
    if (bookings.length === 0) {
      return json({ ok: true, total: 0, sent: 0, failed: 0, skipped_unmapped: 0, results: [] });
    }

    // user 変換
    const gbUserIds = Array.from(new Set(bookings.map((b) => b.user_id)));
    const { data: mapRows, error: mapErr } = await admin
      .from("migration_user_map")
      .select("gymboard_user_id, salute_user_id")
      .eq("tenant_id", TENANT_ID)
      .in("gymboard_user_id", gbUserIds);
    if (mapErr) return json({ ok: false, step: "fetch_map", error: mapErr.message }, 200);
    const gb2salute = new Map<string, string>();
    for (const r of mapRows ?? []) {
      if (r.gymboard_user_id && r.salute_user_id) {
        gb2salute.set(r.gymboard_user_id as string, r.salute_user_id as string);
      }
    }

    let sent = 0;
    let failed = 0;
    let skippedUnmapped = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const b of bookings) {
      const saluteUserId = gb2salute.get(b.user_id as string);
      if (!saluteUserId) {
        skippedUnmapped += 1;
        results.push({ id: b.id, action: "skipped_unmapped_user" });
        continue;
      }
      const action = isCancelled(b.status as string | null) ? "delete" : "insert";
      const payload = {
        gymboard_booking_id: b.id,
        salute_user_id: saluteUserId,
        booking_date: b.booking_date,
        booking_type: b.booking_type,
        status: b.status,
        action,
      };
      try {
        const res = await fetch(targetUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-migration-secret": SHARED_SECRET,
          },
          body: JSON.stringify(payload),
        });
        const txt = await res.text();
        if (res.ok) {
          sent += 1;
          results.push({ id: b.id, action, status: res.status, response: txt.slice(0, 200) });
        } else {
          failed += 1;
          results.push({ id: b.id, action, status: res.status, error: txt.slice(0, 300) });
        }
      } catch (e) {
        failed += 1;
        results.push({ id: b.id, action, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // ============================================================
    // 体験予約 (trial_bookings) のキャンセル逆同期
    // GymBoard でキャンセル (status='キャンセル済み') された体験予約を Salute に伝え、
    // Salute 側の trial_bookings を「キャンセル済み」にして予約サイトの枠を解放する。
    // - 体験予約はゲスト予約で user_id が無いため booking_date + guest_name で突合。
    // - 未来日のみ対象 (過去枠は再予約されないため伝える必要がない & 再送量を抑える)。
    // - 受信側 (Salute の sync-trial-booking-from-gymboard) は冪等。
    // ============================================================
    const trialTargetUrl = `${SALUTE_URL_BASE.replace(/\/$/, "")}/functions/v1/sync-trial-booking-from-gymboard`;
    const nowIso = new Date().toISOString();
    let trialSent = 0;
    let trialFailed = 0;
    const trialResults: Array<Record<string, unknown>> = [];

    const { data: trialRows, error: trialErr } = await admin
      .from("trial_bookings")
      .select("id, booking_date, guest_name, status")
      .eq("tenant_id", TENANT_ID)
      .eq("status", "キャンセル済み")
      .gte("booking_date", nowIso)
      .order("booking_date");

    if (trialErr) {
      trialResults.push({ step: "fetch_trial_bookings", error: trialErr.message });
    } else {
      for (const t of trialRows ?? []) {
        const payload = {
          booking_date: t.booking_date,
          guest_name: t.guest_name,
          action: "cancel",
        };
        try {
          const res = await fetch(trialTargetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-migration-secret": SHARED_SECRET,
            },
            body: JSON.stringify(payload),
          });
          const txt = await res.text();
          if (res.ok) {
            trialSent += 1;
            trialResults.push({ id: t.id, action: "cancel", status: res.status, response: txt.slice(0, 200) });
          } else {
            trialFailed += 1;
            trialResults.push({ id: t.id, action: "cancel", status: res.status, error: txt.slice(0, 300) });
          }
        } catch (e) {
          trialFailed += 1;
          trialResults.push({ id: t.id, action: "cancel", error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return json({
      ok: true,
      tenant_id: TENANT_ID,
      total: bookings.length,
      sent,
      failed,
      skipped_unmapped: skippedUnmapped,
      results,
      trial_cancellations: {
        total: (trialRows ?? []).length,
        sent: trialSent,
        failed: trialFailed,
        results: trialResults,
      },
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
