// Daily reminder for tomorrow's bookings.
// Sends:
//   (A) Web Push to users who have a push subscription
//   (B) Email (transactional) to ALL customers with a booking — as a fallback
// Scheduled by pg_cron at JST 21:00 (UTC 12:00).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Compute tomorrow window (JST) as UTC instants
    const jstNow = new Date(Date.now() + JST_OFFSET_MS);
    const tomorrowJst = new Date(jstNow);
    tomorrowJst.setUTCDate(tomorrowJst.getUTCDate() + 1);
    const y = tomorrowJst.getUTCFullYear();
    const m = tomorrowJst.getUTCMonth();
    const d = tomorrowJst.getUTCDate();
    // JST midnight = UTC of previous day 15:00
    const tomorrowStart = new Date(Date.UTC(y, m, d, 0, 0, 0) - JST_OFFSET_MS);
    const tomorrowEnd = new Date(Date.UTC(y, m, d, 23, 59, 59) - JST_OFFSET_MS);
    const tomorrowDateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    const { data: bookings, error: bookingError } = await supabase
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, status, tenant_id")
      .gte("booking_date", tomorrowStart.toISOString())
      .lte("booking_date", tomorrowEnd.toISOString())
      .eq("status", "予約済み");

    if (bookingError) {
      console.error("Booking query error:", bookingError);
      return new Response(JSON.stringify({ error: bookingError.message }), { status: 500 });
    }

    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ pushSent: 0, emailSent: 0, message: "No bookings tomorrow" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by user_id
    const byUser = new Map<string, typeof bookings>();
    for (const b of bookings) {
      const arr = byUser.get(b.user_id) ?? [];
      arr.push(b);
      byUser.set(b.user_id, arr);
    }

    const userIds = [...byUser.keys()];
    const tenantIds = [...new Set(bookings.map((b) => b.tenant_id).filter(Boolean))] as string[];

    const [{ data: profiles }, { data: subs }, { data: tenants }] = await Promise.all([
      supabase.from("profiles").select("user_id, display_name, plan, tenant_id" as any).in("user_id", userIds),
      supabase.from("push_subscriptions").select("user_id").in("user_id", userIds),
      tenantIds.length
        ? supabase.from("tenants").select("id, gym_name").in("id", tenantIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
    const tenantMap = new Map((tenants ?? []).map((t: any) => [t.id, t]));
    const subscribedUsers = new Set((subs ?? []).map((s: any) => s.user_id));

    let pushSent = 0;
    let emailSent = 0;

    for (const [userId, userBookings] of byUser.entries()) {
      const profile: any = profileMap.get(userId);
      const sorted = [...userBookings].sort(
        (a, b) => new Date(a.booking_date).getTime() - new Date(b.booking_date).getTime(),
      );
      const first = new Date(sorted[0].booking_date);
      const firstJst = new Date(first.getTime() + JST_OFFSET_MS);
      const dateLong = `${firstJst.getUTCMonth() + 1}月${firstJst.getUTCDate()}日（${DOW[firstJst.getUTCDay()]}）`;
      const dateLongEmail = `${firstJst.getUTCFullYear()}年${dateLong}`;
      const times = sorted
        .map((b) => {
          const j = new Date(new Date(b.booking_date).getTime() + JST_OFFSET_MS);
          return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
        })
        .join("、");

      const displayName = profile?.display_name || "お客";
      const planName: string = profile?.plan || sorted[0].booking_type || "";
      const tenantId = sorted[0].tenant_id as string | null;
      const gymName = tenantId ? (tenantMap.get(tenantId) as any)?.gym_name ?? "" : "";

      // (A) Push — only if subscribed
      if (subscribedUsers.has(userId)) {
        try {
          const { error: pushErr } = await supabase.functions.invoke("send-push-notification", {
            body: {
              user_ids: [userId],
              title: "明日のご予約",
              body: `明日 ${dateLong} ${times}〜 トレーニングのご予約があります`,
              url: "/",
              tag: `booking-reminder-${tomorrowDateStr}`,
            },
          });
          if (pushErr) console.error(`Push failed for ${userId}:`, pushErr);
          else pushSent++;
        } catch (e) {
          console.error(`Push exception for ${userId}:`, e);
        }
      }

      // (B) Email — always (Strategy X: email to ALL as a safety net)
      try {
        const { error: emailErr } = await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "booking-reminder",
            recipientEmail: "_resolve_user_",
            idempotencyKey: `booking-reminder-${userId}-${tomorrowDateStr}`,
            templateData: {
              resolveUserId: userId,
              customerName: `${displayName}`,
              bookingDate: dateLongEmail,
              bookingTimes: times,
              planName,
              gymName,
            },
          },
        });
        if (emailErr) console.error(`Email failed for ${userId}:`, emailErr);
        else emailSent++;
      } catch (e) {
        console.error(`Email exception for ${userId}:`, e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        usersTargeted: byUser.size,
        bookingsFound: bookings.length,
        pushSent,
        emailSent,
        date: tomorrowDateStr,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("push-booking-reminder error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
