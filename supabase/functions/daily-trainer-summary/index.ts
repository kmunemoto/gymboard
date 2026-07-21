// トレーナー向け「今日の予定」朝のサマリー通知。
// pg_cron から毎朝7:00 JST頃に1回呼ばれる想定（呼び出し元の設定はSupabase側で管理、
// このリポジトリには含まれない。CRON_SECRET を x-cron-secret ヘッダで渡す既存の
// push-booking-reminder-hourly 等と同じ認証方式）。
// tenants.daily_summary_enabled = false のジムは対象外。
// 同日の再送はしない（notification_dedupe で冪等化）。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const caller = await verifyCaller(req);
  const cronSecret = Deno.env.get("CRON_SECRET");
  const cronAuthorized = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!caller?.isServiceRole && !cronAuthorized) {
    return json({ error: "Forbidden" }, 403);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // JST の「今日」の範囲をUTCで求める。
    const jstNow = new Date(Date.now() + 9 * 3600_000);
    const y = jstNow.getUTCFullYear();
    const m = jstNow.getUTCMonth();
    const d = jstNow.getUTCDate();
    const dateKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayStartUtc = new Date(Date.UTC(y, m, d) - 9 * 3600_000);
    const dayEndUtc = new Date(Date.UTC(y, m, d + 1) - 9 * 3600_000);

    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id, daily_summary_enabled")
      .in("status", ["active", "trial"]);
    if (tErr) throw tErr;

    const targets = (tenants || []).filter((t: any) => t.daily_summary_enabled !== false);
    if (targets.length === 0) {
      return json({ processed: 0, sent: 0, skipped: 0, reason: "no tenants opted in" });
    }

    const fmtTime = (iso: string) => {
      const dt = new Date(new Date(iso).getTime() + 9 * 3600_000);
      return `${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")}`;
    };

    let sent = 0;
    let skipped = 0;
    const results: { tenant_id: string; recipients?: number; items?: number; skipped?: string }[] = [];

    for (const t of targets as { id: string }[]) {
      // 冪等: 同日の再送を防ぐ（cronの多重起動・手動再実行対策）
      const idempotencyKey = `daily-summary-${t.id}-${dateKey}`;
      const { data: existing } = await supabase
        .from("notification_dedupe")
        .select("sent_at")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing?.sent_at) {
        skipped++;
        results.push({ tenant_id: t.id, skipped: "already_sent" });
        continue;
      }

      const [{ data: bookings }, { data: trialBookings }] = await Promise.all([
        supabase
          .from("bookings")
          .select("booking_date, user_id")
          .eq("tenant_id", t.id)
          .eq("status", "予約済み")
          .gte("booking_date", dayStartUtc.toISOString())
          .lt("booking_date", dayEndUtc.toISOString()),
        supabase
          .from("trial_bookings")
          .select("booking_date, guest_name")
          .eq("tenant_id", t.id)
          .neq("status", "キャンセル済み")
          .gte("booking_date", dayStartUtc.toISOString())
          .lt("booking_date", dayEndUtc.toISOString()),
      ]);

      const userIds = [...new Set((bookings || []).map((b: any) => b.user_id as string))];
      const nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);
        (profiles || []).forEach((p: any) => { nameMap[p.user_id] = p.display_name || "顧客"; });
      }

      const items: { time: string; label: string }[] = [
        ...(bookings || []).map((b: any) => ({ time: fmtTime(b.booking_date), label: nameMap[b.user_id] || "顧客" })),
        ...(trialBookings || []).map((tb: any) => ({ time: fmtTime(tb.booking_date), label: `🆕 ${tb.guest_name || "体験ゲスト"}` })),
      ].sort((a, b) => a.time.localeCompare(b.time));

      if (items.length === 0) {
        skipped++;
        results.push({ tenant_id: t.id, skipped: "no_bookings" });
        continue;
      }

      const { data: members } = await supabase
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", t.id)
        .eq("status", "active")
        .in("role", ["owner", "trainer"]);
      const staffIds = (members || []).map((mm: any) => mm.user_id as string);
      if (staffIds.length === 0) {
        skipped++;
        results.push({ tenant_id: t.id, skipped: "no_staff" });
        continue;
      }

      // 冪等キーを先に予約（同時多重起動レース対策。email/waitlist系と同じ方式）
      await supabase
        .from("notification_dedupe")
        .upsert({ idempotency_key: idempotencyKey, sent_at: new Date().toISOString() });

      const MAX_LINES = 8;
      const title = `本日の予定（${items.length}件）`;
      const bodyLines = items.slice(0, MAX_LINES).map((i) => `${i.time} ${i.label}`);
      if (items.length > MAX_LINES) bodyLines.push(`他${items.length - MAX_LINES}件`);
      const body = bodyLines.join("\n");

      try {
        const { error: pushErr } = await supabase.functions.invoke("send-push-notification", {
          body: { user_ids: staffIds, title, body, url: "/", tag: idempotencyKey },
        });
        if (pushErr) {
          console.error(`daily summary push failed tenant=${t.id}:`, pushErr);
        } else {
          sent++;
        }
        results.push({ tenant_id: t.id, recipients: staffIds.length, items: items.length });
      } catch (e) {
        console.error(`daily summary push exception tenant=${t.id}:`, e);
      }
    }

    return json({ processed: targets.length, sent, skipped, results });
  } catch (err) {
    console.error("daily-trainer-summary error:", err);
    return json({ error: String(err) }, 500);
  }
});
