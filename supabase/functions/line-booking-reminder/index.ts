import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const LINE_API = "https://api.line.me/v2/bot/message/push";

Deno.serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")!;

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "LINE_CHANNEL_ACCESS_TOKEN not set" }), { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find bookings for tomorrow (JST)
    const now = new Date();
    // Calculate tomorrow in JST
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);
    const tomorrow = new Date(jstNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStart = new Date(Date.UTC(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 0, 0, 0));
    const tomorrowEnd = new Date(Date.UTC(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 23, 59, 59));

    const { data: bookings, error: bookingError } = await supabase
      .from("bookings")
      .select("id, user_id, booking_date, booking_type, status")
      .gte("booking_date", tomorrowStart.toISOString())
      .lte("booking_date", tomorrowEnd.toISOString())
      .eq("status", "予約済み");

    if (bookingError) {
      console.error("Booking query error:", bookingError);
      return new Response(JSON.stringify({ error: bookingError.message }), { status: 500 });
    }

    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No bookings tomorrow" }), { status: 200 });
    }

    // Get user_ids
    const userIds = [...new Set(bookings.map((b) => b.user_id))];

    // Get profiles with line_user_id
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name, line_user_id, plan")
      .in("user_id", userIds)
      .not("line_user_id", "is", null);

    if (!profiles || profiles.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: "No LINE-linked users with bookings" }), { status: 200 });
    }

    const profileMap = new Map(profiles.map((p) => [p.user_id, p]));

    let sent = 0;
    for (const booking of bookings) {
      const profile = profileMap.get(booking.user_id);
      if (!profile?.line_user_id) continue;

      const bookingDate = new Date(booking.booking_date);
      // Extract time in JST
      const jstBooking = new Date(bookingDate.getTime() + jstOffset);
      const hours = String(jstBooking.getHours()).padStart(2, "0");
      const mins = String(jstBooking.getMinutes()).padStart(2, "0");
      const month = jstBooking.getMonth() + 1;
      const day = jstBooking.getDate();
      const dowChars = ["日", "月", "火", "水", "木", "金", "土"];
      const dow = dowChars[jstBooking.getUTCDay()];
      const planName = (profile as any).plan || booking.booking_type;

      const message = `🔔 明日 ${month}/${day}（${dow}）${hours}:${mins}〜 トレーニング予約\n\n${profile.display_name || "お客"}様、ご予約のリマインドです。\n\nプラン：${planName}\n\nお気をつけてお越しください！\n\nパーソナルジムSalute御所南`;

      const res = await fetch(LINE_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          to: profile.line_user_id,
          messages: [{ type: "text", text: message }],
        }),
      });

      if (res.ok) {
        sent++;
      } else {
        const err = await res.text();
        console.error(`Failed to send reminder to ${booking.user_id}:`, err);
      }
    }

    return new Response(JSON.stringify({ sent, total: bookings.length }), { status: 200 });
  } catch (e) {
    console.error("line-booking-reminder error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});
