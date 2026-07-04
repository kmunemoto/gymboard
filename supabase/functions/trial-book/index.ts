// trial-book: 公開の体験予約作成 API (テナント指定・認証不要)。
//
// 外部の予約サイト (例: app.kyoto-salute.com/trial) や GymBoard 自身の公開ページ
// (/trial/:tenantId) から呼ばれ、予約の作成と通知をサーバー側で完結させる。
// 従来のクライアント直 INSERT + ブラウザからの通知呼び出し (fire-and-forget) は
// 通知の取りこぼし (trial-booking-confirmation が anon 許可リスト外で 403 等) が
// あったため、この関数に一本化する。
//
// POST { tenant_id, guest_name, guest_contact, booking_date }
//   - booking_date: ISO 文字列 (例 "2026-07-10T11:00:00+09:00")
//
// 業務上の拒否 (満枠・回数制限・入力不備) は HTTP 200 + { ok:false, error, code } で返す
// (フロントが supabase.functions.invoke でエラーメッセージをそのまま表示できるように)。
//
// ガード:
//   - テナント実在 + status が active/trial であること
//   - 24時間前まで (サーバー側は23時間で判定し、送信中の境界ズレを許容)
//   - 1ヶ月先まで (サーバー側は32日で判定)
//   - 営業枠 10:00〜21:00 開始・15分刻み (公開ページの枠グリッドと同一)
//   - 同一メールアドレスの連続予約は 24時間で3件まで
//   - 時間帯の重複は BEFORE INSERT の check_booking_overlap トリガーが最終防衛
//
// 通知 (すべて service_role で送信し、結果を response の notify に含める):
//   - お客様宛 確認メール (trial-booking-confirmation)
//   - トレーナー宛 メール (new-booking-notification) / LINE / push
//   - トレーナーの Google カレンダーへ登録 (連携済みの場合)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 予約可能ウィンドウ (公開ページのルールにサーバー側の余裕を持たせた値)
const MIN_LEAD_MS = 23 * 60 * 60 * 1000; // ページ上は24時間前まで
const MAX_AHEAD_MS = 32 * 24 * 60 * 60 * 1000; // ページ上は1ヶ月先まで
const SLOT_MIN_START = 600; // 10:00 (JST 分)
const SLOT_MAX_START = 1260; // 21:00 (JST 分)
const RATE_LIMIT_PER_24H = 3;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 業務上の拒否は 200 で返す (フロントでメッセージ表示しやすくするため)
function reject(code: string, error: string) {
  return json({ ok: false, code, error }, 200);
}

type Payload = {
  tenant_id?: unknown;
  guest_name?: unknown;
  guest_contact?: unknown;
  booking_date?: unknown;
};

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
      return reject("validation", "リクエストの形式が正しくありません。");
    }

    const tenantId = String(body.tenant_id ?? "").trim();
    const guestName = String(body.guest_name ?? "").trim();
    const guestContact = String(body.guest_contact ?? "").trim();
    const bookingDateRaw = String(body.booking_date ?? "").trim();

    if (!UUID_RE.test(tenantId)) return reject("validation", "ジムの指定が正しくありません。");
    if (!guestName || guestName.length > 100) return reject("validation", "お名前を入力してください。");
    if (!EMAIL_RE.test(guestContact) || guestContact.length > 255) {
      return reject("validation", "正しいメールアドレスを入力してください。");
    }

    const bookingInstant = new Date(bookingDateRaw);
    if (!bookingDateRaw || Number.isNaN(bookingInstant.getTime())) {
      return reject("validation", "予約日時の形式が正しくありません。");
    }
    const lead = bookingInstant.getTime() - Date.now();
    if (lead < MIN_LEAD_MS) {
      return reject("too_soon", "ご予約は24時間前までにお願いいたします。別の日時をお選びください。");
    }
    if (lead > MAX_AHEAD_MS) {
      return reject("too_far", "ご予約は1ヶ月先まで承っています。別の日時をお選びください。");
    }
    // JST の開始時刻が営業枠グリッド (10:00〜21:00, 15分刻み) 上にあること
    const jst = new Date(bookingInstant.getTime() + 9 * 60 * 60 * 1000);
    const startMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
    if (startMin < SLOT_MIN_START || startMin > SLOT_MAX_START || startMin % 15 !== 0 || jst.getUTCSeconds() !== 0) {
      return reject("validation", "選択できない時間帯です。表示された空き枠からお選びください。");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ===== テナント確認 =====
    const { data: tenant, error: tErr } = await admin
      .from("tenants")
      .select("id, gym_name, status")
      .eq("id", tenantId)
      .maybeSingle();
    if (tErr) return json({ ok: false, error: `tenant lookup failed: ${tErr.message}` }, 500);
    if (!tenant || !["active", "trial"].includes(tenant.status as string)) {
      return reject("tenant_not_found", "ジムが見つかりません。予約リンクをご確認ください。");
    }
    const gymName = (tenant.gym_name as string) || "ジム";

    // ===== 連続予約ガード (同一メール 24時間で3件まで) =====
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount, error: rlErr } = await admin
      .from("trial_bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("guest_contact", guestContact)
      .gte("created_at", since);
    if (rlErr) return json({ ok: false, error: `rate limit check failed: ${rlErr.message}` }, 500);
    if ((recentCount ?? 0) >= RATE_LIMIT_PER_24H) {
      return reject("rate_limited", "短時間に複数のご予約をいただいたため受付を制限しています。お手数ですがジムへ直接ご連絡ください。");
    }

    // ===== 予約作成 (重複は check_booking_overlap トリガーが拒否する) =====
    const { data: inserted, error: insErr } = await admin
      .from("trial_bookings")
      .insert({
        tenant_id: tenantId,
        guest_name: guestName,
        guest_contact: guestContact,
        booking_date: bookingDateRaw,
        // booking_type / status は DB デフォルト ('初回無料体験' / '予約済み')。
        // '予約済み' で入れることで send-trial-reminders の前日リマインドも対象になる。
      })
      .select("id, booking_date")
      .single();

    if (insErr) {
      const msg = insErr.message ?? "";
      if (msg.includes("この時間帯") || /overlap/i.test(msg)) {
        return reject("slot_taken", "この時間帯はすでに予約が入っています。別の時間をお選びください。");
      }
      return json({ ok: false, error: `insert failed: ${msg}` }, 500);
    }
    const trialBookingId = inserted.id as string;

    // ===== 表示用の日時文字列 (JST) =====
    const dowChars = ["日", "月", "火", "水", "木", "金", "土"];
    const dateStr = `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日（${dowChars[jst.getUTCDay()]}）`;
    const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const timeStr = `${fmt(startMin)}〜${fmt(startMin + 60)}`;

    // ===== 通知 (失敗しても予約自体は成立。結果を notify に記録) =====
    const notify: Record<string, boolean | string> = {};
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
        });
        const text = await res.text();
        console.log(`[trial-book] ${name} status=${res.status} body=${text.slice(0, 160)}`);
        return res.ok;
      } catch (e) {
        console.error(`[trial-book] ${name} failed:`, e instanceof Error ? e.message : String(e));
        return false;
      }
    };

    const safeContact = guestContact.replace(/[^A-Za-z0-9._@+-]/g, "_");
    const notifyKey = `${bookingDateRaw}-${safeContact}`;

    // トレーナー解決: テナント所属のトレーナーを優先し、無ければ従来の get_trainer_ids
    let trainerId: string | null = null;
    try {
      const { data: tm } = await admin
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("role", "trainer")
        .neq("status", "cancelled")
        .order("created_at", { ascending: true })
        .limit(1);
      trainerId = tm?.[0]?.user_id ?? null;
    } catch {
      trainerId = null;
    }
    if (!trainerId) {
      try {
        const { data: roles } = await admin.rpc("get_trainer_ids");
        trainerId = (roles as Array<{ user_id: string }> | null)?.[0]?.user_id ?? null;
      } catch {
        trainerId = null;
      }
    }

    // 1) お客様宛 確認メール
    notify.customer_email = await invokeFn("send-transactional-email", {
      templateName: "trial-booking-confirmation",
      recipientEmail: guestContact,
      idempotencyKey: `trial-confirm-${notifyKey}`,
      templateData: {
        customerName: guestName,
        bookingDate: dateStr,
        bookingTime: timeStr,
      },
    });

    if (trainerId) {
      // 2) トレーナー宛 メール
      notify.trainer_email = await invokeFn("send-transactional-email", {
        templateName: "new-booking-notification",
        recipientEmail: "_resolve_trainer_",
        idempotencyKey: `trial-notify-${notifyKey}`,
        templateData: {
          customerName: `${guestName}（初回無料体験）`,
          bookingDate: dateStr,
          bookingTime: timeStr,
          planName: "初回無料体験",
          dashboardUrl: "https://gymboard.lovable.app",
          trainerUserId: trainerId,
        },
      });

      // 3) トレーナー宛 LINE (未連携なら送信側が無視する)
      notify.trainer_line = await invokeFn("send-line-message", {
        user_id: trainerId,
        message: `【${gymName}】新規の体験予約が入りました。\n\n・お名前：${guestName} 様\n・日時：${dateStr} ${timeStr}\n\nアプリの予約管理画面から詳細を確認してください。`,
      });
    } else {
      notify.trainer_email = "skipped_no_trainer";
      notify.trainer_line = "skipped_no_trainer";
    }

    // 4) トレーナー宛 push
    notify.trainer_push = await invokeFn("send-push-notification", {
      purpose: "trial_booking",
      trial_booking_id: trialBookingId,
    });

    // 5) トレーナーの Google カレンダーへ登録 (連携済みの場合のみ成功する)
    notify.google_calendar = await invokeFn("google-calendar-sync", {
      action: "create",
      booking_id: trialBookingId,
      booking_date: bookingDateRaw,
      booking_type: "初回無料体験",
      client_name: `🆕 ${guestName}`,
      is_trial: true,
    });

    return json({
      ok: true,
      trial_booking_id: trialBookingId,
      tenant_id: tenantId,
      booking_date: inserted.booking_date,
      notify,
    }, 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
