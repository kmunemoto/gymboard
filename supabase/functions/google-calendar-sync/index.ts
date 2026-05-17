import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, booking_id, booking_date, booking_type, client_name, google_event_id, is_trial } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Get trainer's Google Calendar tokens
    const { data: trainerIds } = await supabase.rpc("get_trainer_ids");
    const trainerId = trainerIds?.[0]?.user_id;
    if (!trainerId) {
      return new Response(JSON.stringify({ skipped: true, reason: "no trainer" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: tokenRow } = await supabase
      .from("google_calendar_tokens")
      .select("*")
      .eq("user_id", trainerId)
      .maybeSingle();

    if (!tokenRow) {
      return new Response(JSON.stringify({ skipped: true, reason: "no google calendar linked" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh token if expired
    let accessToken = tokenRow.access_token;
    if (new Date(tokenRow.expires_at) <= new Date()) {
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokenRow.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const refreshData = await refreshRes.json();
      if (!refreshRes.ok || !refreshData.access_token) {
        console.error("Token refresh failed:", refreshData);
        return new Response(JSON.stringify({ error: "Token refresh failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessToken = refreshData.access_token;
      const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
      await supabase
        .from("google_calendar_tokens")
        .update({ access_token: accessToken, expires_at: newExpiry })
        .eq("user_id", trainerId);
    }

    const calendarId = tokenRow.calendar_id || "primary";
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    if (action === "create") {
      const startDt = new Date(booking_date);
      const endDt = new Date(startDt.getTime() + 60 * 60 * 1000); // 60 min session

      const event = {
        summary: `🏋️ ${client_name || "顧客"} - ${booking_type || "トレーニング"}`,
        description: `プラン: ${booking_type}\nお客様: ${client_name}\n\nパーソナルジムSalute御所南`,
        start: { dateTime: startDt.toISOString(), timeZone: "Asia/Tokyo" },
        end: { dateTime: endDt.toISOString(), timeZone: "Asia/Tokyo" },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
      };

      const createRes = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      });

      const created = await createRes.json();
      if (!createRes.ok) {
        console.error("Google Calendar create error:", created);
        return new Response(JSON.stringify({ error: "Failed to create event", detail: created }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Save event ID to booking
      if (booking_id && created.id) {
        const table = is_trial ? "trial_bookings" : "bookings";
        await supabase
          .from(table)
          .update({ google_event_id: created.id })
          .eq("id", booking_id);
      }

      return new Response(JSON.stringify({ success: true, event_id: created.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else if (action === "delete") {
      if (!google_event_id) {
        return new Response(JSON.stringify({ skipped: true, reason: "no event id" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const deleteRes = await fetch(`${baseUrl}/${google_event_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // Treat 404 (not found) and 410 (already deleted) as success — the event is gone either way
      if (!deleteRes.ok && deleteRes.status !== 404 && deleteRes.status !== 410) {
        const errText = await deleteRes.text();
        console.error("Google Calendar delete error:", errText);
        return new Response(JSON.stringify({ error: "Failed to delete event", detail: errText }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (booking_id) {
        const table = is_trial ? "trial_bookings" : "bookings";
        await supabase
          .from(table)
          .update({ google_event_id: null })
          .eq("id", booking_id);
      }

      return new Response(JSON.stringify({ success: true, already_gone: deleteRes.status === 410 || deleteRes.status === 404 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else if (action === "sync_all") {
      // Sync all existing bookings that don't have a google_event_id yet
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, booking_date, booking_type, user_id, google_event_id")
        .is("google_event_id", null)
        .neq("status", "キャンセル済み")
        .gte("booking_date", new Date().toISOString());

      // Also sync trial bookings
      const { data: trialBookings } = await supabase
        .from("trial_bookings")
        .select("id, booking_date, booking_type, guest_name, google_event_id")
        .is("google_event_id", null)
        .neq("status", "キャンセル済み")
        .gte("booking_date", new Date().toISOString());

      const allItems = [
        ...(bookings || []).map((b) => ({ ...b, source: "bookings" as const })),
        ...(trialBookings || []).map((t) => ({ ...t, user_id: null, source: "trial_bookings" as const, guest_name: t.guest_name })),
      ];

      if (allItems.length === 0) {
        return new Response(JSON.stringify({ success: true, synced: 0 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get customer names for regular bookings
      const userIds = [...new Set(allItems.filter((b) => b.source === "bookings" && b.user_id).map((b) => b.user_id!))];
      const nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds);
        profiles?.forEach((p) => (nameMap[p.user_id] = p.display_name || "顧客"));
      }

      let synced = 0;
      for (const item of allItems) {
        const startDt = new Date(item.booking_date);
        const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
        const cName = item.source === "trial_bookings"
          ? (item as any).guest_name || "体験ゲスト"
          : nameMap[item.user_id!] || "顧客";
        const label = item.source === "trial_bookings" ? "🆕 初回体験" : "🏋️";

        const event = {
          summary: `${label} ${cName} - ${item.booking_type || "トレーニング"}`,
          description: `プラン: ${item.booking_type}\nお客様: ${cName}\n\nパーソナルジムSalute御所南`,
          start: { dateTime: startDt.toISOString(), timeZone: "Asia/Tokyo" },
          end: { dateTime: endDt.toISOString(), timeZone: "Asia/Tokyo" },
          reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
        };

        const createRes = await fetch(baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        });

        if (createRes.ok) {
          const created = await createRes.json();
          await supabase
            .from(item.source)
            .update({ google_event_id: created.id })
            .eq("id", item.id);
          synced++;
        } else {
          const errText = await createRes.text();
          console.error(`Failed to sync ${item.source} ${item.id}:`, errText);
        }
      }

      return new Response(JSON.stringify({ success: true, synced }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("google-calendar-sync error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
