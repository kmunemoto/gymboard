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
    .select("id, booking_date, booking_type, status, tenant_id")
    .eq("user_id", profile.user_id)
    .neq("status", "キャンセル済み")
    // 同日キャンセル消化（来店しない予約）も購読カレンダーに出さない
    .neq("status", "同日キャンセル済み")
    .gte("booking_date", now)
    .order("booking_date", { ascending: true });

  if (bookingsError) {
    return new Response("Error fetching bookings", { status: 500 });
  }

  // 予約1件の表示時間（DTEND）は「そのジムのセッション長＋予約バッファ」。profiles.tenant_id は
  // マルチテナント以前の名残で信頼できないため、各予約行自身の tenant_id から引く。
  const tenantIds = [...new Set((bookings || []).map((b) => b.tenant_id).filter(Boolean))] as string[];
  const bufferByTenant = new Map<string, number>();
  const sessionByTenant = new Map<string, number>();
  if (tenantIds.length > 0) {
    const { data: tenantRows } = await supabase
      .from("tenants")
      .select("id, booking_buffer_minutes, slot_duration_minutes")
      .in("id", tenantIds);
    (tenantRows || []).forEach((t: any) => {
      bufferByTenant.set(t.id, t.booking_buffer_minutes ?? 15);
      sessionByTenant.set(t.id, t.slot_duration_minutes ?? 60);
    });
  }

  const calName = "ジムボード 予約";
  const eventTitle = "ジムボード";

  const events = (bookings || []).map((b) => {
    const bufferMinutes = (b.tenant_id && bufferByTenant.get(b.tenant_id)) ?? 15;
    const sessionMinutes = (b.tenant_id && sessionByTenant.get(b.tenant_id)) ?? 60;
    const start = new Date(b.booking_date);
    const end = new Date(start.getTime() + (sessionMinutes + bufferMinutes) * 60 * 1000);
    return [
      "BEGIN:VEVENT",
      `UID:${b.id}@gymboard`,
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
    "PRODID:-//Gymboard//Calendar//JP",
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
      "Content-Disposition": 'attachment; filename="gymboard.ics"',
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
});
