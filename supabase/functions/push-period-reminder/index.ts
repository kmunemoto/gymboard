// 利用期間リマインド（日次）。
// サブスク（月N回など）のお客様で、利用期間の期限が近く（最終利用日まで 7日 or 3日）
// かつ残り予約回数があるお客様へプッシュ通知を送る。
// 「残り○回・期限まであと○日です。ご予約はこちら」。
// pg_cron から JST 10:00（UTC 01:00）などに 1日1回呼び出す想定。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";
import {
  computeSubscriptionUsage,
  isoToJstYmd,
  periodReminderDaysLeft,
} from "../_shared/cycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const REMINDER_DAYS = [7, 3];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const caller = await verifyCaller(req);
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  const cronAuthorized = !!cronSecret && headerSecret === cronSecret;
  if (!caller?.isServiceRole && !cronAuthorized) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 今日（JST）の yyyy-MM-dd
    const jstNow = new Date(Date.now() + JST_OFFSET_MS);
    const nowJstYmd = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, "0")}-${String(jstNow.getUTCDate()).padStart(2, "0")}`;

    // 対象候補: プランと起算日を持つお客様（サブスク判定は tenant_plans で行う）
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("user_id, display_name, plan, cycle_start_date, cycle_start_pinned, tenant_id, grace_enabled, show_usage_period" as any)
      .not("plan", "is", null)
      .not("cycle_start_date", "is", null);
    if (profErr) throw profErr;
    if (!profiles || profiles.length === 0) {
      return json({ sent: 0, message: "no candidates" });
    }

    const userIds = profiles.map((p: any) => p.user_id);
    const tenantIds = [...new Set(profiles.map((p: any) => p.tenant_id).filter(Boolean))] as string[];

    const [{ data: plans }, { data: prefs }, { data: tenants }, { data: bookings }] = await Promise.all([
      tenantIds.length
        ? supabase.from("tenant_plans").select("tenant_id, plan_name, plan_type, max_sessions, cycle_months, cycle_unit, grace_days").in("tenant_id", tenantIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from("notification_preferences").select("user_id, reminder_period").in("user_id", userIds),
      tenantIds.length
        ? supabase.from("tenants").select("id, gym_name").in("id", tenantIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from("bookings").select("user_id, booking_date, status").in("user_id", userIds).neq("status", "キャンセル済み"),
    ]);

    const planMap = new Map<string, any>();
    (plans ?? []).forEach((p: any) => planMap.set(`${p.tenant_id}|${p.plan_name}`, p));
    const tenantMap = new Map((tenants ?? []).map((t: any) => [t.id, t]));
    // 未設定 => 受け取る（後方互換）
    const optedOut = new Set(
      (prefs ?? []).filter((p: any) => p.reminder_period === false).map((p: any) => p.user_id),
    );
    const bookingsByUser = new Map<string, string[]>();
    (bookings ?? []).forEach((b: any) => {
      const arr = bookingsByUser.get(b.user_id) ?? [];
      arr.push(b.booking_date);
      bookingsByUser.set(b.user_id, arr);
    });

    let sent = 0;
    const targeted: { user_id: string; daysLeft: number; remaining: number }[] = [];

    for (const p of profiles as any[]) {
      if (optedOut.has(p.user_id)) continue;
      // 「利用期間の表示」をこのお客様にオフにしているジムには、期限を明かす通知も送らない
      // （UI(PlanUsageCard)で非表示にしても、この通知が漏れ穴になっていたため 2026-07 に追加）。
      if (p.show_usage_period === false) continue;
      const tp = p.tenant_id ? planMap.get(`${p.tenant_id}|${p.plan}`) : null;
      // サブスク以外（回数券・期間）や、回数上限の無いプラン（通い放題）は対象外
      if (!tp || (tp.plan_type && tp.plan_type !== "subscription")) continue;
      if (tp.max_sessions == null) continue;

      const graceDays = p.grace_enabled === false ? 0 : tp.grace_days ?? 0;
      const usage = computeSubscriptionUsage({
        startYmd: isoToJstYmd(`${p.cycle_start_date}T00:00:00+09:00`),
        maxSessions: tp.max_sessions,
        cycleMonths: tp.cycle_months,
        cycleUnit: tp.cycle_unit,
        graceDays,
        bookingIsos: bookingsByUser.get(p.user_id) ?? [],
        nowJstYmd,
        anchorToFirstBooking: true, // 表示（クライアント）と同じ「1回目の予約日起点」で期限を判定
        pinned: p.cycle_start_pinned === true, // 起算日固定のお客様は店が決めた窓のまま
      });
      if (!usage || usage.periodPending || usage.isUnlimited) continue;
      const remaining = usage.remaining ?? 0;
      if (remaining <= 0) continue;

      const daysLeft = periodReminderDaysLeft(usage.windowEnd, nowJstYmd);
      if (!REMINDER_DAYS.includes(daysLeft)) continue;

      const displayName = p.display_name || "お客";
      const gymName = p.tenant_id ? (tenantMap.get(p.tenant_id) as any)?.gym_name ?? "" : "";
      const body = `${displayName}様 残り${remaining}回・利用期限まであと${daysLeft}日です。お早めにご予約ください${gymName ? `（${gymName}）` : ""}`;

      try {
        const { error: pushErr } = await supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: [p.user_id],
            title: "ご利用期限が近づいています",
            body,
            url: "/booking",
            tag: `period-reminder-${nowJstYmd}`,
          },
        });
        if (pushErr) console.error(`period push failed for ${p.user_id}:`, pushErr);
        else {
          sent++;
          targeted.push({ user_id: p.user_id, daysLeft, remaining });
        }
      } catch (e) {
        console.error(`period push exception for ${p.user_id}:`, e);
      }
    }

    return json({ success: true, date: nowJstYmd, candidates: profiles.length, sent, targeted });
  } catch (e) {
    console.error("push-period-reminder error:", e);
    return json({ error: String(e) }, 500);
  }

  function json(obj: unknown, status = 200) {
    return new Response(JSON.stringify(obj), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
