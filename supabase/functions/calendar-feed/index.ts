import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function escapeIcal(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up user by calendar_token
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .eq("calendar_token", token)
    .maybeSingle();

  if (profileError || !profile) {
    return new Response("Invalid token", { status: 404 });
  }

  // Fetch future bookings for this user
  const now = new Date().toISOString();
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id, booking_date, booking_type, status")
    .eq("user_id", profile.user_id)
    .neq("status", "キャンセル済み")
    .gte("booking_date", now)
    .order("booking_date", { ascending: true });

  if (bookingsError) {
    return new Response("Error fetching bookings", { status: 500 });
  }

  const calName = "Salute 御所南 予約";
  const eventTitle = "パーソナルジムSalute 御所南";

  const events = (bookings || []).map((b) => {
    const start = new Date(b.booking_date);
    const end = new Date(start.getTime() + 75 * 60 * 1000); // 75 minutes
    return [
      "BEGIN:VEVENT",
      `UID:${b.id}@salute-goshonan`,
      `DTSTART:${toIcalDate(start)}`,
      `DTEND:${toIcalDate(end)}`,
      `SUMMARY:${escapeIcal(eventTitle)}`,
      `DESCRIPTION:${escapeIcal(b.booking_type || "")}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
    ].join("\r\n");
  });

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Salute Goshonan//Calendar//JP",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcal(calName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ical, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="salute.ics"',
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
});
