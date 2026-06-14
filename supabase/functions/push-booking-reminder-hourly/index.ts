// Hourly reminder: notify ~1 hour before a booking starts.
// Cron: every 15 minutes. Window = bookings starting in [now+45min, now+60min).
// Combined with notification_dedupe (idempotency_key=reminder-1h-${booking_id})
// to guarantee at-most-once delivery even if the cron drifts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Window: [now+45min, now+60min)
    const now = Date.now();
    const windowStart = new Date(now + 45 * 60 * 1000);
    const windowEnd = new Date(now + 60 * 60 * 1000);

    const { data: bookings, error: bookingError } = await supabase
      .from("bookings")
      .select("id, user_id, booking_date, status")
      .gte("booking_date", windowStart.toISOString())
      .lt("booking_date", windowEnd.toISOString())
      .eq("status", "予約済み");

    if (bookingError) {
      console.error("Booking query error:", bookingError);
      return new Response(JSON.stringify({ error: bookingError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ sent: 0, skipped: 0, message: "No bookings in window" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userIds = [...new Set(bookings.map((b) => b.user_id))];

    // Filter out users who opted out of 1-hour-before reminder.
    // Missing record = both ON (backward compat).
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("user_id, reminder_hour_before")
      .in("user_id", userIds);
    const optedOut = new Set(
      (prefs ?? [])
        .filter((p: { reminder_hour_before: boolean }) => p.reminder_hour_before === false)
        .map((p: { user_id: string }) => p.user_id),
    );

    let sent = 0;
    let skipped = 0;

    for (const b of bookings) {
      if (optedOut.has(b.user_id)) {
        skipped++;
        continue;
      }
      const idempotencyKey = `reminder-1h-${b.id}`;

      // Dedupe: skip if already sent (any prior send for this booking)
      const { data: existing } = await supabase
        .from("notification_dedupe")
        .select("idempotency_key")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      // Reserve key BEFORE sending to prevent races between overlapping cron runs.
      const { error: insertErr } = await supabase
        .from("notification_dedupe")
        .insert({ idempotency_key: idempotencyKey, sent_at: new Date().toISOString() });
      if (insertErr) {
        // Likely unique-key race — another run already claimed it.
        skipped++;
        continue;
      }

      const dt = new Date(b.booking_date);
      const jst = new Date(dt.getTime() + JST_OFFSET_MS);
      const m = jst.getUTCMonth() + 1;
      const d = jst.getUTCDate();
      const hh = String(jst.getUTCHours()).padStart(2, "0");
      const mm = String(jst.getUTCMinutes()).padStart(2, "0");

      try {
        const { error: pushErr } = await supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: [b.user_id],
            title: "まもなくご予約",
            body: `${m}/${d} ${hh}:${mm}〜 トレーニングのご予約があります`,
            url: "/",
            tag: idempotencyKey,
          },
        });
        if (pushErr) {
          console.error(`Push failed for booking ${b.id}:`, pushErr);
        } else {
          sent++;
        }
      } catch (e) {
        console.error(`Push exception for booking ${b.id}:`, e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        bookingsFound: bookings.length,
        sent,
        skipped,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("push-booking-reminder-hourly error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
