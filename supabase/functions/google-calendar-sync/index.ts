import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";

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
  supabase: SupabaseClient,
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

/** 予約行（予定の中身・消す予定の ID は、呼び出し元ではなくここから取る） */
interface BookingRow {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  booking_date: string;
  booking_type: string | null;
  option_minutes: number;
  google_event_id: string | null;
  guest_name: string | null;
}

async function loadBooking(
  supabase: SupabaseClient,
  bookingId: string,
  isTrial: boolean,
): Promise<BookingRow | null> {
  // 列を名指ししない（未適用の列があっても落とさない。ほかの関数と同じ作法）
  const { data } = await supabase
    .from(isTrial ? "trial_bookings" : "bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    tenant_id: (row.tenant_id as string | null) ?? null,
    user_id: isTrial ? null : ((row.user_id as string | null) ?? null),
    booking_date: String(row.booking_date),
    booking_type: (row.booking_type as string | null) ?? null,
    option_minutes: isTrial ? 0 : Math.max(0, Number(row.option_minutes ?? 0) || 0),
    google_event_id: (row.google_event_id as string | null) ?? null,
    guest_name: isTrial ? ((row.guest_name as string | null) ?? null) : null,
  };
}

/** その予約のジムで、有効なスタッフ（オーナー・トレーナー）か。印（hasRole）は使わない */
async function isActiveStaffOf(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("tenant_members")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "trainer"])
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * テナントの「Googleカレンダー連携済みのジム側ユーザー(owner/trainer)」のトークンを返す。
 * マルチテナントのため、予約が属するテナントのジム担当者を対象にする。
 * （単一テナント時代の get_trainer_ids()[0] だと別テナントの担当者を拾ってしまい、
 *   連携済みでも予約が同期されない不具合になっていた）
 */
async function getTenantCalendarToken(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<any | null> {
  // インストラクター（staff_access = limited）の連携は店の予定に使わない（2026-10-28）。
  // 使うと、先生がつないだ自分のカレンダーにお客様全員の予約が入りうる（どの行を拾うかは順不同）。
  const { data: staff } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("role", ["owner", "trainer"])
    .neq("staff_access", "limited");
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

    const body = await req.json();
    const { action, booking_date, booking_type, client_name, option_minutes } = body ?? {};
    const is_trial = body?.is_trial === true;
    const booking_id: string | undefined = typeof body?.booking_id === "string" ? body.booking_id : undefined;
    if (!action || !ALLOWED_ACTIONS.has(action)) {
      console.warn("google-calendar-sync: invalid action", action);
      return json({ error: "Invalid action" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ---- AUTHZ（2026-10-31・穴11 の続き）----
    // 🔴 印（hasRole(trainer)）は使わない。誰でも取れるうえジムに結びついていないので、
    //    以前は印を付けるだけで他のジムのオーナーのカレンダーに予定を作れた（google-calendar-sync-1）。
    //   - service_role（trial-book・drop-in-book・trial-cancel）… 今まで通り
    //   - その予約のジムの有効なスタッフ … その予約の作成・削除
    //   - お客様 … 自分の予約（体験は除く）の作成・削除だけ
    //   - sync_all … 呼んだ人が有効なスタッフのジムだけ
    let booking: BookingRow | null = null;
    let tenantId: string | null;
    if (action === "sync_all") {
      tenantId = await resolveTenantId(supabase, action, undefined, false, caller.userId);
      if (!caller.isServiceRole && !tenantId) {
        return json({ error: "Forbidden" }, 403);
      }
    } else {
      if (!booking_id) {
        return json({ error: "booking_id required" }, 400);
      }
      booking = await loadBooking(supabase, booking_id, is_trial);
      tenantId = booking?.tenant_id ?? null;
      if (!caller.isServiceRole) {
        const isStaff = !!tenantId && !!caller.userId && await isActiveStaffOf(supabase, tenantId, caller.userId);
        const isOwnBooking = !is_trial && !!booking && booking.user_id === caller.userId;
        if (!isStaff && !isOwnBooking) {
          return json({ error: "Forbidden" }, 403);
        }
      }
    }

    // ---- テナント & その連携済みカレンダー(トークン)を解決 ----
    console.log(`[gcal-sync] action=${action} caller=${caller.userId ?? "service"} tenant=${tenantId ?? "null"}`);
    if (!tenantId) {
      return json({ skipped: true, reason: "no tenant" });
    }

    const tokenRow = await getTenantCalendarToken(supabase, tenantId);
    console.log(`[gcal-sync] tokenFound=${!!tokenRow} tokenUser=${(tokenRow as any)?.user_id ?? "none"} calendar=${(tokenRow as any)?.calendar_id ?? "-"}`);
    if (!tokenRow) {
      return json({ skipped: true, reason: "no google calendar linked" });
    }

    // カレンダーイベントの長さ（分）。ジムごとに変更可能（tenants.slot_duration_minutes）。
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("slot_duration_minutes")
      .eq("id", tenantId)
      .maybeSingle();
    const sessionMinutes = (tenantRow as any)?.slot_duration_minutes ?? 60;

    // プランごとのセッション長上書き（tenant_plans.slot_duration_minutes）。null/未設定は
    // 上のジムの既定値（sessionMinutes）を継承する（src/lib/planSlotDuration.ts と同じ
    // 「null=継承」の作法）。体験予約(trial_bookings)はプランと無関係なので対象外。
    const { data: planRows } = await supabase
      .from("tenant_plans")
      .select("plan_name, slot_duration_minutes")
      .eq("tenant_id", tenantId);
    const sessionByPlan = new Map<string, number>();
    (planRows || []).forEach((p: any) => {
      if (p.slot_duration_minutes != null) sessionByPlan.set(p.plan_name, p.slot_duration_minutes);
    });
    const resolveSessionMinutes = (planName?: string | null) =>
      (planName && sessionByPlan.get(planName)) ?? sessionMinutes;

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
      if (!booking) {
        return json({ skipped: true, reason: "booking not found" });
      }
      // 1予約につき予定は1件。今のカレンダーに実在するなら作らない（同じ予約で何度呼ばれても増えない）
      if (booking.google_event_id) {
        const checkRes = await fetch(`${baseUrl}/${encodeURIComponent(booking.google_event_id)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (checkRes.ok) {
          return json({ success: true, event_id: booking.google_event_id, already_present: true });
        }
      }

      // 🔴 予定の中身は予約行から作る（google-calendar-sync-2）。以前はリクエストの日時・文面をそのまま使っていたので、
      //    お客様が自分の予約1件で、店のカレンダーに任意の文面・日時の予定を何件でも作れた。
      //    service_role の呼び出し元（trial-book・drop-in-book）だけは、表示用のラベル（🆕/🌏 付きの名前など）を渡せる。
      const trusted = caller.isServiceRole;
      let displayName: string;
      if (trusted && typeof client_name === "string" && client_name) {
        displayName = client_name;
      } else if (is_trial) {
        displayName = booking.guest_name || "体験ゲスト";
      } else {
        const { data: prof } = await supabase
          .from("profiles").select("display_name").eq("user_id", booking.user_id ?? "").maybeSingle();
        displayName = (prof as { display_name?: string | null } | null)?.display_name || "顧客";
      }
      const eventType = trusted && typeof booking_type === "string" && booking_type ? booking_type : booking.booking_type;
      const eventDate = trusted && typeof booking_date === "string" && booking_date ? booking_date : booking.booking_date;

      const startDt = new Date(eventDate);
      // オプション（トレーニング後のストレッチ等）ぶんも予定の長さに入れる。ここを足さないと
      // トレーナー自身の Google カレンダーだけ60分のままになり、ジムボードの予定表と食い違う。
      const createOptionMinutes = trusted && option_minutes != null
        ? Math.max(0, Number(option_minutes) || 0)
        : booking.option_minutes;
      const endDt = new Date(startDt.getTime()
        + (resolveSessionMinutes(is_trial ? null : booking.booking_type) + createOptionMinutes) * 60 * 1000);

      const event = {
        summary: `🏋️ ${displayName} - ${eventType || "トレーニング"}`,
        description: `プラン: ${eventType}\nお客様: ${displayName}\n\nジムボード`,
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

      if (created.id) {
        const table = is_trial ? "trial_bookings" : "bookings";
        await supabase.from(table).update({ google_event_id: created.id }).eq("id", booking.id);
      }

      return json({ success: true, event_id: created.id });
    } else if (action === "delete") {
      // 🔴 消す予定は予約行の google_event_id だけ（リクエストの ID は使わない）。
      //    以前はリクエストの ID をエンコードせずに URL へ連結していたので、他の予定や別のパスを指せた。
      const eventId = booking?.google_event_id ?? null;
      if (!booking || !eventId) {
        return json({ skipped: true, reason: "no event id" });
      }

      const deleteRes = await fetch(`${baseUrl}/${encodeURIComponent(eventId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!deleteRes.ok && deleteRes.status !== 404 && deleteRes.status !== 410) {
        const errText = await deleteRes.text();
        console.error("Google Calendar delete error:", errText);
        return json({ error: "Failed to delete event", detail: errText }, 200);
      }

      {
        const table = is_trial ? "trial_bookings" : "bookings";
        await supabase.from(table).update({ google_event_id: null }).eq("id", booking.id);
      }

      return json({ success: true, already_gone: deleteRes.status === 410 || deleteRes.status === 404 });
    } else if (action === "sync_all") {
      // このテナントの、未キャンセル・今後の予約を対象にする。
      // 既に google_event_id を持つ予約も、そのIDのイベントが現カレンダーに実在するか
      // 確認し、無ければ（過去の不具合で別カレンダーに作られた/消えた場合）作り直す。
      const nowIso = new Date().toISOString();
      const { data: bookings } = await supabase.from("bookings")
        .select("id, booking_date, booking_type, user_id, google_event_id, option_minutes")
        .eq("tenant_id", tenantId)
        .neq("status", "キャンセル済み")
        .gte("booking_date", nowIso);

      const { data: trialBookings } = await supabase.from("trial_bookings")
        .select("id, booking_date, booking_type, guest_name, google_event_id")
        .eq("tenant_id", tenantId)
        .neq("status", "キャンセル済み")
        .gte("booking_date", nowIso);

      const allItems = [
        ...(bookings || []).map((b) => ({ ...b, source: "bookings" as const })),
        ...(trialBookings || []).map((t) => ({ ...t, user_id: null, source: "trial_bookings" as const, guest_name: t.guest_name })),
      ];

      console.log(`[gcal-sync] sync_all tenant=${tenantId} bookings=${bookings?.length ?? 0} trial=${trialBookings?.length ?? 0} total=${allItems.length}`);

      if (allItems.length === 0) {
        return json({ success: true, synced: 0, total: 0, reason: "no upcoming bookings for tenant" });
      }

      const userIds = [...new Set(allItems.filter((b) => b.source === "bookings" && b.user_id).map((b) => b.user_id!))];
      const nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles")
          .select("user_id, display_name").in("user_id", userIds);
        profiles?.forEach((p) => (nameMap[p.user_id] = p.display_name || "顧客"));
      }

      let synced = 0;
      let alreadyPresent = 0;
      for (const item of allItems) {
        // 既存IDがあり、そのイベントが現カレンダーに実在するならスキップ（重複防止）
        if (item.google_event_id) {
          const checkRes = await fetch(`${baseUrl}/${encodeURIComponent(item.google_event_id)}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (checkRes.ok) { alreadyPresent++; continue; }
          // 404/410 等 → このカレンダーには無い → 以下で作り直す
        }

        const startDt = new Date(item.booking_date);
        const itemSessionMinutes = item.source === "bookings"
          ? resolveSessionMinutes(item.booking_type)
            + Math.max(0, Number((item as { option_minutes?: number | null }).option_minutes ?? 0) || 0)
          : sessionMinutes;
        const endDt = new Date(startDt.getTime() + itemSessionMinutes * 60 * 1000);
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

      console.log(`[gcal-sync] sync_all done tenant=${tenantId} synced=${synced} alreadyPresent=${alreadyPresent} total=${allItems.length}`);
      return json({ success: true, synced, alreadyPresent, total: allItems.length });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    console.error("google-calendar-sync error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
