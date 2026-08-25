// drop-in-book: 公開のドロップイン予約作成API (テナント指定・認証不要)。
//
// trial-book の複製。英語圏の観光客向け「単発ドロップインセッション(¥8,000・現地決済・
// 会員登録不要)」専用エンドポイント。予約データは trial-book と同じ trial_bookings
// テーブルに書く(空き枠のオーバーラップ判定 get_tenant_booked_slots / check_booking_overlap
// トリガーが既にこのテーブルを見ているため、同じ枠管理に自然に乗る)。booking_kind='drop_in'
// で区別し、無料体験専用のリマインド (send-trial-reminders, Salute限定・日本語文面) の対象からは
// 除外する。
//
// POST { tenant_id, guest_name, guest_contact, booking_date }
//   - booking_date: ISO 文字列 (例 "2026-07-10T11:00:00+09:00")
//
// 業務上の拒否は HTTP 200 + { ok:false, error, code } で返す (英語文言)。
// 予期しない失敗 (500) は詳細をログにのみ残し、クライアントには汎用メッセージを返す。
//
// バリデーション・レート制限・営業時間ルールは trial-book と同一の値を使う
// (同じトレーナーのカレンダー枠を共有するため)。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

// trial-book と同一の予約可能ウィンドウ・営業枠 (同じカレンダーを共有するため)。
const DEADLINE_GRACE_MS = 10 * 60 * 1000;
const MAX_AHEAD_MS = 12 * 24 * 60 * 60 * 1000; // ページ上は10日先まで、+2日のバッファ
const SLOT_MIN_START = 600; // 10:00 (JST 分)
const SLOT_MAX_START = 1260; // 21:00 (JST 分)
const RATE_LIMIT_PER_CONTACT_24H = 3;
const RATE_LIMIT_PER_TENANT_1H = 20;
const CANCELLED = "キャンセル済み";
const BOOKING_TYPE_LABEL = "ドロップイン（¥8,000）";

const GENERIC_ERROR = "Something went wrong on our end. Please try again in a moment.";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function reject(code: string, error: string) {
  return json({ ok: false, code, error }, 200);
}

function fail(step: string, detail: string) {
  console.error(`[drop-in-book] ${step} failed: ${detail}`);
  return json({ ok: false, error: GENERIC_ERROR }, 500);
}

type Payload = {
  tenant_id?: unknown;
  guest_name?: unknown;
  guest_contact?: unknown;
  booking_date?: unknown;
  custom_answers?: unknown;
};

/**
 * 予約時のカスタム質問（booking_questions）への回答スナップショット。
 *
 * 🔴 **クライアントから来た値をそのまま信用して保存しない。**
 * 公開ページ（未ログイン）から届くので、形・件数・長さをここで削る。
 * DB 側にも CHECK があるが、そこで落ちると予約自体が失敗する。
 * 「回答が壊れているせいで予約が取れない」のは筋が悪いので、**黙って捨てる**。
 *
 * 制限値は src/lib/bookingQuestions.ts と揃えてある
 * （ANSWER_MAX_LENGTH=500 / 1予約あたり10件）。
 */
function sanitizeCustomAnswers(raw: unknown): { question_id: string; label: string; value: string }[] | null {
  if (!Array.isArray(raw)) return null;
  const out: { question_id: string; label: string; value: string }[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim().slice(0, 120) : "";
    const value = typeof rec.value === "string" ? rec.value.trim().slice(0, 500) : "";
    if (!label || !value) continue;
    out.push({
      question_id: typeof rec.question_id === "string" ? rec.question_id.slice(0, 64) : "",
      label,
      value,
    });
  }
  return out.length > 0 ? out : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let body: Payload;
    try {
      body = await req.json();
    } catch {
      return reject("validation", "Your request could not be read. Please try again.");
    }

    const tenantId = String(body.tenant_id ?? "").trim();
    const guestName = String(body.guest_name ?? "").trim();
    const guestContact = String(body.guest_contact ?? "").trim();
    const bookingDateRaw = String(body.booking_date ?? "").trim();
    const customAnswers = sanitizeCustomAnswers(body.custom_answers);

    if (!UUID_RE.test(tenantId)) return reject("validation", "This booking link is invalid.");
    if (!guestName || guestName.length > 100) return reject("validation", "Please enter your name.");
    if (!EMAIL_RE.test(guestContact) || guestContact.length > 255) {
      return reject("validation", "Please enter a valid email address.");
    }

    if (!ISO_DATETIME_RE.test(bookingDateRaw)) {
      return reject("validation", "The selected date/time format is invalid.");
    }
    const bookingInstant = new Date(bookingDateRaw);
    if (Number.isNaN(bookingInstant.getTime())) {
      return reject("validation", "The selected date/time format is invalid.");
    }
    const jst = new Date(bookingInstant.getTime() + 9 * 60 * 60 * 1000);
    const jstDayStartMs = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 60 * 60 * 1000;
    if (Date.now() >= jstDayStartMs + DEADLINE_GRACE_MS) {
      return reject("too_soon", "Drop-in sessions must be booked by the day before your visit. Please pick another date.");
    }
    const lead = bookingInstant.getTime() - Date.now();
    if (lead > MAX_AHEAD_MS) {
      return reject("too_far", "Bookings are only available up to 10 days ahead. Please pick a closer date.");
    }
    const startMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
    if (startMin < SLOT_MIN_START || startMin > SLOT_MAX_START || startMin % 15 !== 0 || jst.getUTCSeconds() !== 0) {
      return reject("validation", "That time slot isn't available. Please choose one of the times shown.");
    }

    // ===== 提供ジムの確認 =====
    // ドロップイン(¥8,000・現地決済・英語のみ)は Salute御所南 が観光客向けに
    // 独自に始めた機能で、他ジムには提供していない。料金・言語・決済手段が
    // すべて固定なので、他ジムのIDで叩かれても受け付けない。
    // 画面側(src/pages/DropInBooking.tsx)でも同じ判定をしているが、
    // 直接APIを叩かれる経路があるためサーバー側でも弾く。
    // 提供ジムを増やすときは tenants に料金・提供有無の列を足して置き換えること。
    const DROP_IN_TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";
    if (tenantId !== DROP_IN_TENANT_ID) {
      return reject("not_available", "This gym does not offer drop-in sessions.");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ===== テナント確認 =====
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .select("id, gym_name, status, address, email, website_url, slot_duration_minutes, booking_email_note")
      .eq("id", tenantId)
      .maybeSingle();
    if (tErr) return fail("tenant_lookup", tErr.message);
    if (!tenant || !["active", "trial"].includes(tenant.status as string)) {
      return reject("tenant_not_found", "We couldn't find this gym. Please check your booking link.");
    }
    const gymName = (tenant.gym_name as string) || "the gym";
    const gymAddress = ((tenant.address as string | null) ?? "").trim();
    const gymContactEmail = ((tenant.email as string | null) ?? "").trim();
    const gymWebsiteUrl = ((tenant.website_url as string | null) ?? "").trim();

    // ===== 連続予約ガード (trial と共有のカウント。tenant_id 全体で見るため kind をまたいで数える) =====
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: contactCount, error: rlErr } = await admin
      .from("trial_bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("guest_contact", guestContact)
      .neq("status", CANCELLED)
      .gte("created_at", since24h);
    if (rlErr) return fail("rate_limit_contact", rlErr.message);
    if ((contactCount ?? 0) >= RATE_LIMIT_PER_CONTACT_24H) {
      return reject("rate_limited", "We've received multiple booking requests from you recently. Please contact the gym directly.");
    }
    const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: tenantCount, error: tlErr } = await admin
      .from("trial_bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("created_at", since1h);
    if (tlErr) return fail("rate_limit_tenant", tlErr.message);
    if ((tenantCount ?? 0) >= RATE_LIMIT_PER_TENANT_1H) {
      return reject("rate_limited", "Bookings are currently very busy. Please try again shortly, or contact the gym directly.");
    }

    // ===== 予約作成 (重複は check_booking_overlap トリガーが拒否する) =====
    const { data: inserted, error: insErr } = await admin
      .from("trial_bookings")
      .insert({
        tenant_id: tenantId,
        guest_name: guestName,
        guest_contact: guestContact,
        booking_date: bookingDateRaw,
        ...(customAnswers ? { custom_answers: customAnswers } : {}),
        booking_type: BOOKING_TYPE_LABEL,
        booking_kind: "drop_in",
      })
      .select("id, booking_date, cancel_token")
      .single();

    if (insErr) {
      const msg = insErr.message ?? "";
      if (msg.includes("この時間帯") || /overlap/i.test(msg)) {
        return reject("slot_taken", "That time slot was just booked. Please choose another time.");
      }
      return fail("insert", msg);
    }
    const dropInBookingId = inserted.id as string;
    const cancelToken = inserted.cancel_token as string;
    const cancelUrl = `${SUPABASE_URL}/functions/v1/trial-cancel?token=${cancelToken}`;

    // ===== 表示用の日時文字列 (英語表記) =====
    const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dateStr = `${monthNames[jst.getUTCMonth()]} ${jst.getUTCDate()} (${dowNames[jst.getUTCDay()]})`;
    const fmt12 = (m: number) => {
      const h24 = Math.floor(m / 60);
      const mm = m % 60;
      const period = h24 >= 12 ? "PM" : "AM";
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
    };
    const sessionMinutes = (tenant.slot_duration_minutes as number | null) ?? 60;
    const timeStr = `${fmt12(startMin)} - ${fmt12(startMin + sessionMinutes)}`;
    // トレーナー向け通知は日本語表記も併記する
    const dowCharsJa = ["日", "月", "火", "水", "木", "金", "土"];
    const dateStrJa = `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日（${dowCharsJa[jst.getUTCDay()]}）`;
    const fmtJa = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const timeStrJa = `${fmtJa(startMin)}〜${fmtJa(startMin + sessionMinutes)}`;

    // ===== 通知 (失敗しても予約自体は成立。結果を notify に記録) =====
    const serviceHeaders = {
      "Content-Type": "application/json",
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
    };
    const invokeFn = async (name: string, payload: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
          method: "POST",
          headers: serviceHeaders,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        console.log(`[drop-in-book] ${name} status=${res.status} body=${text.slice(0, 160)}`);
        return res.ok;
      } catch (e) {
        console.error(`[drop-in-book] ${name} failed:`, e instanceof Error ? e.message : String(e));
        return false;
      }
    };

    const safeContact = guestContact.replace(/[^A-Za-z0-9._@+-]/g, "_");
    const notifyKey = `${bookingDateRaw}-${safeContact}`;

    let trainerId: string | null = null;
    const { data: staff, error: staffErr } = await admin
      .from("tenant_members")
      .select("user_id, role")
      .eq("tenant_id", tenantId)
      .in("role", ["trainer", "owner"])
      .eq("status", "active")
      .order("joined_at", { ascending: true });
    if (staffErr) console.error("[drop-in-book] staff lookup failed:", staffErr.message);
    const staffRows = staff ?? [];
    trainerId = (staffRows.find((m) => m.role === "trainer") ?? staffRows[0])?.user_id ?? null;

    const notify: Record<string, boolean | string> = {};
    const tasks: Array<Promise<void>> = [];

    // 1) お客様宛 確認メール (英語)
    tasks.push(
      invokeFn("send-transactional-email", {
        templateName: "drop-in-booking-confirmation",
        tenantId,
        recipientEmail: guestContact,
        idempotencyKey: `dropin-confirm-${notifyKey}`,
        templateData: {
          customerName: guestName,
          bookingDate: dateStr,
          bookingTime: timeStr,
          gymName,
          gymAddress,
          gymContactEmail,
          gymWebsiteUrl,
          // 確認メールに足す、店からのご案内。空/未設定ならブロックごと出さない。
          gymNote: ((tenant.booking_email_note as string | null | undefined) ?? "").trim() || null,
        },
      }).then((ok) => { notify.customer_email = ok; }),
    );

    if (trainerId) {
      // 2) トレーナー宛 メール (日本語・ドロップインと分かる文言)
      tasks.push(
        invokeFn("send-transactional-email", {
          templateName: "new-booking-notification",
          tenantId,
          recipientEmail: "_resolve_trainer_",
          idempotencyKey: `dropin-notify-${notifyKey}`,
          templateData: {
            customerName: `${guestName}（ドロップイン予約・¥8,000）`,
            bookingDate: dateStrJa,
            bookingTime: timeStrJa,
            planName: BOOKING_TYPE_LABEL,
            gymName,
            dashboardUrl: "https://app.kyoto-salute.com",
            trainerUserId: trainerId,
          },
        }).then((ok) => { notify.trainer_email = ok; }),
      );

      // 3) トレーナー宛 LINE
      tasks.push(
        invokeFn("send-line-message", {
          user_id: trainerId,
          message: `【${gymName}】新規のドロップイン予約（¥8,000・現地決済）が入りました。\n\n・お名前：${guestName} 様\n・日時：${dateStrJa} ${timeStrJa}\n\nアプリの予約管理画面から詳細を確認してください。`,
        }).then((ok) => { notify.trainer_line = ok; }),
      );
    } else {
      notify.trainer_email = "skipped_no_trainer";
      notify.trainer_line = "skipped_no_trainer";
    }

    // 4) トレーナー宛 push
    tasks.push(
      invokeFn("send-push-notification", {
        purpose: "trial_booking",
        trial_booking_id: dropInBookingId,
      }).then((ok) => { notify.trainer_push = ok; }),
    );

    // 5) トレーナーの Google カレンダーへ登録
    tasks.push(
      invokeFn("google-calendar-sync", {
        action: "create",
        booking_id: dropInBookingId,
        booking_date: bookingDateRaw,
        booking_type: "ドロップイン",
        client_name: `🌏 ${guestName}`,
        is_trial: true,
      }).then((ok) => { notify.google_calendar = ok; }),
    );

    await Promise.all(tasks);

    return json({
      ok: true,
      drop_in_booking_id: dropInBookingId,
      cancel_token: cancelToken,
      cancel_url: cancelUrl,
      tenant_id: tenantId,
      booking_date: inserted.booking_date,
      notify,
    }, 200);
  } catch (e) {
    console.error("[drop-in-book] unexpected:", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: GENERIC_ERROR }, 500);
  }
});
