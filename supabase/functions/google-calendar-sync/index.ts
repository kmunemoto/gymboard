import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller, hasRole } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_ACTIONS = new Set(["create", "delete", "sync_all"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * リクエスト対象のテナントIDを判定する。
 * - sync_all: 呼び出したトレーナー自身が所属するテナント。
 * - create / delete: 予約行(bookings / trial_bookings)の tenant_id。
 */
async function resolveTenantId(
  supabase: ReturnType<typeof createClient>,
  action: string,
  booking_id: string | undefined,
  is_trial: boolean | undefined,
  callerUserId: string | null,
): Promise<string | null> {
  if (action === "sync_all") {
    if (!callerUserId) return null;
    const { data } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", callerUserId)
      .eq("status", "active")
      .in("role", ["owner", "trainer"])
      .limit(1);
    return (data as any)?.[0]?.tenant_id ?? null;
  }
  if (!booking_id) return null;
  const table = is_trial ? "trial_bookings" : "bookings";
  const { data } = await supabase
    .from(table)
    .select("tenant_id")
    .eq("id", booking_id)
    .maybeSingle();
  return (data as any)?.tenant_id ?? null;
}

/**
 * テナントの「Googleカレンダー連携済みのジム側ユーザー(owner/trainer)」のトークンを返す。
 * マルチテナントのため、予約が属するテナントのジム担当者を対象にする。
 * （単一テナント時代の get_trainer_ids()[0] だと別テナントの担当者を拾ってしまい、
 *   連携済みでも予約が同期されない不具合になっていた）
 */
async function getTenantCalendarToken(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<any | null> {
  const { data: staff } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("role", ["owner", "trainer"]);
  const staffIds = (staff || []).map((s: any) => s.user_id);
  if (staffIds.length === 0) return null;

  const { data: tokens } = await supabase
    .from("google_calendar_tokens")
    .select("*")
    .in("user_id", staffIds)
    .limit(1);
  return tokens?.[0] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ---- AUTH ----
    const caller = await verifyCaller(req);
    if (!caller) return json({ error: "Unauthorized" }, 401);

    const { action, booking_id, booking_date, booking_type, client_name, google_event_id, is_trial } = await req.json();
    if (!action || !ALLOWED_ACTIONS.has(action)) {
      console.warn("google-calendar-sync: invalid action", action);
      return json({ error: "Invalid action" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ---- AUTHZ ----
    // Trainers / service role: full access (existing behavior).
    // Customers: only "create" or "delete" for a booking they own (non-trial).
    if (!caller.isServiceRole) {
      const isTrainer = caller.userId ? await hasRole(caller.userId, "trainer") : false;
      if (!isTrainer) {
        if (action === "sync_all" || is_trial) {
          return json({ error: "Forbidden" }, 403);
        }
        if (!booking_id || typeof booking_id !== "string") {
          return json({ error: "booking_id required" }, 400);
        }
        const { data: bk } = await supabase
          .from("bookings")
          .select("id, user_id")
          .eq("id", booking_id)
          .maybeSingle();
        if (!bk || bk.user_id !== caller.userId) {
          return json({ error: "Forbidden" }, 403);
        }
      }
    }

    // ---- テナント & その連携済みカレンダー(トークン)を解決 ----
    const tenantId = await resolveTenantId(supabase, action, booking_id, is_trial, caller.userId);
    if (!tenantId) {
      return json({ skipped: true, reason: "no tenant" });
    }

    const tokenRow = await getTenantCalendarToken(supabase, tenantId);
    if (!tokenRow) {
      return json({ skipped: true, reason: "no google calendar linked" });
    }

    // ---- アクセストークン（期限切れならリフレッシュ）----
    let accessToken = tokenRow.access_token;
    if (new Date(tokenRow.expires_at) <= new Date()) {
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId, client_secret: clientSecret,
          refresh_token: tokenRow.refresh_token, grant_type: "refresh_token",
        }),
      });
      const refreshData = await refreshRes.json();
      if (!refreshRes.ok || !refreshData.access_token) {
        console.error("Token refresh failed:", refreshData);
        return json({ error: "Token refresh failed" }, 500);
      }
      accessToken = refreshData.access_token;
      const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
      await supabase.from("google_calendar_tokens")
        .update({ access_token: accessToken, expires_at: newExpiry }).eq("user_id", tokenRow.user_id);
    }

    const calendarId = tokenRow.calendar_id || "primary";
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    if (action === "create") {
      const startDt = new Date(booking_date);
      const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);

      const event = {
        summary: `🏋️ ${client_name || "顧客"} - ${booking_type || "トレーニング"}`,
        description: `プラン: ${booking_type}\nお客様: ${client_name}\n\nジムボード`,
        start: { dateTime: startDt.toISOString(), timeZone: "Asia/Tokyo" },
        end: { dateTime: endDt.toISOString(), timeZone: "Asia/Tokyo" },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
      };

      const createRes = await fetch(baseUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });

      const created = await createRes.json();
      if (!createRes.ok) {
        console.error("Google Calendar create error:", created);
        return json({ error: "Failed to create event", detail: created }, 500);
      }

      if (booking_id && created.id) {
        const table = is_trial ? "trial_bookings" : "bookings";
        await supabase.from(table).update({ google_event_id: created.id }).eq("id", booking_id);
      }

      return json({ success: true, event_id: created.id });
    } else if (action === "delete") {
      if (!google_event_id) {
        return json({ skipped: true, reason: "no event id" });
      }

      const deleteRes = await fetch(`${baseUrl}/${google_event_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!deleteRes.ok && deleteRes.status !== 404 && deleteRes.status !== 410) {
        const errText = await deleteRes.text();
        console.error("Google Calendar delete error:", errText);
        return json({ error: "Failed to delete event", detail: errText }, 200);
      }

      if (booking_id) {
        const table = is_trial ? "trial_bookings" : "bookings";
        await supabase.from(table).update({ google_event_id: null }).eq("id", booking_id);
      }

      return json({ success: true, already_gone: deleteRes.status === 410 || deleteRes.status === 404 });
    } else if (action === "sync_all") {
      // このテナントの、未同期・未キャンセル・今後の予約だけを対象にする
      const nowIso = new Date().toISOString();
      const { data: bookings } = await supabase.from("bookings")
        .select("id, booking_date, booking_type, user_id, google_event_id")
        .eq("tenant_id", tenantId)
        .is("google_event_id", null).neq("status", "キャンセル済み")
        .gte("booking_date", nowIso);

      const { data: trialBookings } = await supabase.from("trial_bookings")
        .select("id, booking_date, booking_type, guest_name, google_event_id")
        .eq("tenant_id", tenantId)
        .is("google_event_id", null).neq("status", "キャンセル済み")
        .gte("booking_date", nowIso);

      const allItems = [
        ...(bookings || []).map((b) => ({ ...b, source: "bookings" as const })),
        ...(trialBookings || []).map((t) => ({ ...t, user_id: null, source: "trial_bookings" as const, guest_name: t.guest_name })),
      ];

      if (allItems.length === 0) {
        return json({ success: true, synced: 0 });
      }

      const userIds = [...new Set(allItems.filter((b) => b.source === "bookings" && b.user_id).map((b) => b.user_id!))];
      const nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles")
          .select("user_id, display_name").in("user_id", userIds);
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
          description: `プラン: ${item.booking_type}\nお客様: ${cName}\n\nジムボード`,
          start: { dateTime: startDt.toISOString(), timeZone: "Asia/Tokyo" },
          end: { dateTime: endDt.toISOString(), timeZone: "Asia/Tokyo" },
          reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
        };

        const createRes = await fetch(baseUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(event),
        });

        if (createRes.ok) {
          const created = await createRes.json();
          await supabase.from(item.source).update({ google_event_id: created.id }).eq("id", item.id);
          synced++;
        } else {
          const errText = await createRes.text();
          console.error(`Failed to sync ${item.source} ${item.id}:`, errText);
        }
      }

      return json({ success: true, synced });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    console.error("google-calendar-sync error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
