// 予約の通知（店宛メール・お客様の受付確認メール・プッシュ）。
//
// ── なぜサーバー側に移したか（2026-08-21）────────────────────────────
//
// もともと通知は src/lib/bookingNotification.ts（＝**お客様の端末**）が
// 予約作成の直後に fire-and-forget で送っていた。端末は送信前に
// 「自分のジムはどこか」「スタッフは誰か」をネットワーク越しに引き直すため、
//
//   ・回線の瞬断・アプリ復帰直後などでどれか1つ失敗すると **console.warn だけで黙って消える**
//   ・お客様本人への確認メールはこの解決を必要としないので、
//     「本人には届くのに店には届かない」という最悪の形で壊れる
//
// 実測: 店宛だけ消えた予約が 8/8・8/15・8/20 の3件、お客様宛だけ消えたのが4件。
// email_send_log の時刻分析で「invoke がそもそも呼ばれていない」ことを確認した。
// メッセージ通知で同じ壊れ方を直した notify-new-message（2026-08-11）に倣う。
//
// 呼び出し元は bookings の AFTER INSERT トリガー（notify_booking_created）。
// pg_net で vault の cron_secret を x-cron-secret に載せて叩く。
//
// ── 入力は booking_id と log_id だけ ─────────────────────────────
// タイトルや本文を受け取らない。**実在する予約の内容しか通知に載らない**ようにするため。
// 文面の材料（顧客名・ジム名・プラン・時刻）はすべて service_role でDBから読み直す。
//
// ── 旧クライアントとの二重送信 ─────────────────────────────────
// 公開済みの旧アプリは今までどおり端末からも送る。冪等キーを旧クライアントと
// **同じ文字列**（booking-notify-<id> / booking-confirm-customer-<id>）にすることで、
// send-transactional-email 側の重複排除が1通に畳む。🔴 このキーを変えると旧アプリと
// の重複排除が壊れて二重送信になる（bookingNotifyServerSide.test.ts が固定している）。
// プッシュのタグも旧クライアントと同じ `booking-<id>`（Web は置き換えで畳まれる。
// ネイティブは畳めず、旧アプリの更新までは二重に鳴りうる）。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// メールのボタンの飛び先。Edge Function（Deno）は src/lib/brand.ts を import
// できないので写しを置いている（send-push-notification の ALLOWED_URL_HOSTS と同じ扱い）。
// 唯一の宣言は src/lib/brand.ts の PRODUCTION_WEB_ORIGIN。
const PRODUCTION_WEB_ORIGIN = "https://app.kyoto-salute.com";

/** 予約済みの status 値（bookings.status の既定値。useBookings と同じ文字列）。 */
const ACTIVE_STATUS = "予約済み";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** booking_date(timestamptz) を JST の表示要素に分解する。 */
function jstParts(iso: string) {
  const j = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return {
    month: j.getUTCMonth() + 1,
    day: j.getUTCDate(),
    dow: WEEKDAYS_JA[j.getUTCDay()],
    minutes: j.getUTCHours() * 60 + j.getUTCMinutes(),
  };
}

const hhmm = (minutes: number) => `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // notify-new-message と同じ認可。service_role か CRON_SECRET のいずれかを必須にする。
  const caller = await verifyCaller(req);
  const cronSecret = Deno.env.get("CRON_SECRET");
  const cronAuthorized = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!caller?.isServiceRole && !cronAuthorized) {
    return json({ error: "Forbidden" }, 403);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 記録簿（booking_notify_log）への反映。ここが失敗しても通知は続ける。
  let logId: string | null = null;
  const patchLog = async (patch: Record<string, unknown>) => {
    if (!logId) return;
    const { error } = await supabase.from("booking_notify_log").update(patch).eq("id", logId);
    if (error) console.error("booking_notify_log update failed:", error);
  };

  try {
    const { booking_id, log_id } = await req.json().catch(() => ({ booking_id: null }));
    if (!booking_id || typeof booking_id !== "string") {
      return json({ error: "booking_id required" }, 400);
    }
    logId = typeof log_id === "string" ? log_id : null;

    const { data: booking, error: bkErr } = await supabase
      .from("bookings")
      .select("id, tenant_id, user_id, booking_date, booking_type, status, created_via")
      .eq("id", booking_id)
      .maybeSingle();
    if (bkErr) throw bkErr;
    // 送信直後にキャンセルされた等。通知する内容が無いので黙って終わる。
    if (!booking) {
      await patchLog({ skip_reason: "booking_not_found" });
      return json({ skipped: "booking_not_found" });
    }
    if (booking.status !== ACTIVE_STATUS || booking.created_via === "reschedule" || !booking.tenant_id) {
      // トリガー側でも弾いているが、手動で叩かれたときのための二重ガード
      const reason = booking.status !== ACTIVE_STATUS ? "not_active"
        : booking.created_via === "reschedule" ? "reschedule" : "no_tenant";
      await patchLog({ skip_reason: reason });
      return json({ skipped: reason });
    }

    // 誰の操作か（自己予約か代理予約か）は booking_notify_log の actor_user_id で判別する。
    // bookings の列からは区別できない（トリガーが INSERT 時の auth.uid() を採っている）。
    let actorUserId: string | null = null;
    if (logId) {
      const { data: logRow } = await supabase
        .from("booking_notify_log")
        .select("actor_user_id")
        .eq("id", logId)
        .maybeSingle();
      actorUserId = (logRow?.actor_user_id as string | null) ?? null;
    }
    const isSelfBooking = actorUserId !== null && actorUserId === booking.user_id;

    const [tenantRes, planRes, profileRes, staffRes] = await Promise.all([
      supabase
        .from("tenants")
        .select("gym_name, booking_email_note, slot_duration_minutes")
        .eq("id", booking.tenant_id)
        .maybeSingle(),
      supabase
        .from("tenant_plans")
        .select("slot_duration_minutes")
        .eq("tenant_id", booking.tenant_id)
        .eq("plan_name", booking.booking_type)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", booking.user_id)
        .maybeSingle(),
      supabase
        .from("tenant_members")
        .select("user_id, role, joined_at")
        .eq("tenant_id", booking.tenant_id)
        .in("role", ["trainer", "owner"])
        .eq("status", "active")
        .order("joined_at", { ascending: true }),
    ]);

    const gymName = (tenantRes.data?.gym_name as string | null) ?? null;
    const gymNote = (tenantRes.data?.booking_email_note as string | null) ?? null;
    // プラン側に設定があれば優先、無ければテナント既定、どちらも無ければ60分
    // （resolvePlanSlotMinutes / sendCancelEmailNotification と同じ「null=継承」の作法）
    const sessionMinutes =
      (planRes.data?.slot_duration_minutes as number | null) ??
      (tenantRes.data?.slot_duration_minutes as number | null) ??
      60;
    const customerName = (profileRes.data?.display_name as string | null)?.trim() || "お客様";

    // 代表スタッフ: trainer（joined_at昇順）→ owner（同）。fetchMyTenantStaffIds と同じ順序。
    const staffRows = (staffRes.data ?? []) as { user_id: string; role: string }[];
    const staffIds = [
      ...new Set([
        ...staffRows.filter((m) => m.role === "trainer").map((m) => m.user_id),
        ...staffRows.filter((m) => m.role === "owner").map((m) => m.user_id),
      ]),
    ];
    const trainerId = staffIds[0] ?? null;

    const { month, day, dow, minutes } = jstParts(booking.booking_date as string);
    const formattedDate = `${month}月${day}日（${dow}）`;
    const startTime = hhmm(minutes);
    const endTime = hhmm(minutes + sessionMinutes);
    const bookingTime = `${startTime}〜${endTime}`;
    const planName = booking.booking_type as string;

    const errors: string[] = [];

    // ---- 店宛の新規予約メール ----
    if (trainerId) {
      const { error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "new-booking-notification",
          recipientEmail: "_resolve_trainer_",
          idempotencyKey: `booking-notify-${booking.id}`,
          templateData: {
            customerName,
            bookingDate: formattedDate,
            bookingTime,
            planName,
            gymName: gymName ?? undefined,
            dashboardUrl: PRODUCTION_WEB_ORIGIN,
            trainerUserId: trainerId,
          },
        },
      });
      if (error) errors.push(`trainer email: ${String(error)}`);
    } else {
      // スタッフゼロのジム。宛先が無いだけで顧客側の確認は出すので全体は止めない。
      errors.push("trainer email: no_staff");
    }

    // ---- お客様宛の受付確認メール ----
    {
      const { error } = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "booking-confirmation",
          recipientEmail: "_resolve_user_",
          idempotencyKey: `booking-confirm-customer-${booking.id}`,
          templateData: {
            customerName,
            bookingDate: formattedDate,
            bookingTime,
            planName,
            gymName: gymName ?? undefined,
            gymNote,
            resolveUserId: booking.user_id,
          },
        },
      });
      if (error) errors.push(`customer email: ${String(error)}`);
    }

    // ---- プッシュ（スタッフ全員＋お客様本人）----
    // 自己予約のみ（代理予約は従来もプッシュ無し。店が自分の操作の通知を受ける意味が薄い）。
    // 定期予約は1行ごとにこの関数が呼ばれるため、テナント×顧客×開始時刻の
    // 10分窓で1回に畳む（trial_booking の抑止と同じ仕組み）。
    let pushResult = "skipped:proxy";
    if (isSelfBooking) {
      pushResult = "sent";
      const pushKey = `booking-push-${booking.tenant_id}-${booking.user_id}-${startTime}`;
      const { data: existing } = await supabase
        .from("notification_dedupe")
        .select("idempotency_key, sent_at")
        .eq("idempotency_key", pushKey)
        .maybeSingle();
      const fresh = existing?.sent_at &&
        Date.now() - new Date(existing.sent_at as string).getTime() < 10 * 60 * 1000;
      if (fresh) {
        pushResult = "skipped:duplicate";
      } else {
        await supabase
          .from("notification_dedupe")
          .upsert({ idempotency_key: pushKey, sent_at: new Date().toISOString() });
        const { error: pushErr } = await supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: [...new Set([...staffIds, booking.user_id])],
            title: "新しい予約",
            body: `${customerName}が${month}月${day}日 ${startTime}〜${endTime}を予約しました`,
            url: "/",
            // 旧クライアントの自前プッシュと同じタグ（Web は置き換えで1件に畳まれる）
            tag: `booking-${booking.id}`,
          },
        });
        if (pushErr) {
          // 予約した抑止キーを戻す（残すと再実行してもプッシュできない）
          await supabase.from("notification_dedupe").delete().eq("idempotency_key", pushKey);
          errors.push(`push: ${String(pushErr)}`);
          pushResult = "error";
        }
      }
    }

    await patchLog({
      dispatched_at: new Date().toISOString(),
      last_error: errors.length > 0 ? errors.join("; ") : null,
    });

    return json({ booking_id: booking.id, push: pushResult, errors });
  } catch (err) {
    console.error("notify-new-booking error:", err);
    await patchLog({ last_error: String(err) });
    return json({ error: String(err) }, 500);
  }
});
