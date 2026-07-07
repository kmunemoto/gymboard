// trial-cancel: 体験予約のお客様セルフキャンセル API (認証不要・トークン認可)。
//
// 体験予約はアカウント無しのゲストが作成するため、予約1件ごとの秘密トークン
// (trial_bookings.cancel_token) を「本人の合言葉」として使う。確認メール／予約完了画面の
// キャンセルリンクにこのトークンが埋め込まれており、それを知っている＝本人、とみなす。
// これにより「キャンセルはジムのメールへ連絡」という従来フローをワンタップに置き換える。
//
// POST { token, action }
//   - action: "info"   → キャンセル画面表示用に予約概要を返す (PII は最小限)
//   - action: "cancel" → 実際にキャンセルする
//
// action:"cancel" の処理:
//   1. Google カレンダー連携イベントを削除 (連携時のみ・失敗してもキャンセルは継続)
//   2. status を「キャンセル済み」に更新
//   3. トレーナーへ通知 (push + LINE) — 枠が空いたことを即座に知らせる
//
// 業務上の拒否 (トークン不正・過去の予約) は HTTP 200 + { ok:false, code } で返す。
// 予期しない失敗 (500) は詳細をログにのみ残し、汎用メッセージを返す。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANCELLED = "キャンセル済み";
const GENERIC_ERROR = "サーバーで問題が発生しました。時間をおいて再度お試しください。";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function reject(code: string, error: string) {
  return json({ ok: false, code, error }, 200);
}

function fail(step: string, detail: string) {
  console.error(`[trial-cancel] ${step} failed: ${detail}`);
  return json({ ok: false, error: GENERIC_ERROR }, 500);
}

// JST の日時表示文字列を作る
const dowChars = ["日", "月", "火", "水", "木", "金", "土"];
function formatJst(bookingDate: string): { dateStr: string; timeStr: string } {
  const bd = new Date(bookingDate);
  const jst = new Date(bd.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日（${dowChars[jst.getUTCDay()]}）`;
  const fmt = (n: number) => String(n).padStart(2, "0");
  const startMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  const endMin = startMin + 60;
  const timeStr = `${fmt(Math.floor(startMin / 60))}:${fmt(startMin % 60)}〜${fmt(Math.floor(endMin / 60))}:${fmt(endMin % 60)}`;
  return { dateStr, timeStr };
}

type Payload = { token?: unknown; action?: unknown };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let payload: Payload;
    try {
      payload = await req.json();
    } catch {
      return reject("validation", "リクエストの形式が正しくありません。");
    }

    const token = String(payload.token ?? "").trim();
    const action = String(payload.action ?? "info").trim();
    if (!UUID_RE.test(token)) {
      return reject("invalid_token", "キャンセル用のリンクが正しくありません。");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ===== トークンで予約を特定 (推測困難な cancel_token が本人確認の代わり) =====
    const { data: booking, error: bErr } = await admin
      .from("trial_bookings")
      .select("id, tenant_id, guest_name, booking_date, status, google_event_id, tenants(gym_name)")
      .eq("cancel_token", token)
      .maybeSingle();
    if (bErr) return fail("lookup", bErr.message);
    if (!booking) return reject("invalid_token", "キャンセル用のリンクが正しくありません。");

    // 埋め込みの tenants は many-to-one のためオブジェクトで返るが、環境差を吸収して配列も許容する
    const tenantRel = (booking as any).tenants;
    const gymName = (Array.isArray(tenantRel) ? tenantRel[0]?.gym_name : tenantRel?.gym_name) || "ジム";
    const { dateStr, timeStr } = formatJst(booking.booking_date as string);
    const alreadyCancelled = booking.status === CANCELLED;
    const isPast = new Date(booking.booking_date as string).getTime() <= Date.now();

    const summary = {
      guestName: booking.guest_name,
      gymName,
      date: dateStr,
      time: timeStr,
      status: booking.status,
      alreadyCancelled,
      isPast,
      cancellable: !alreadyCancelled && !isPast,
    };

    // ===== info: 画面表示用の概要のみ返す =====
    if (action !== "cancel") {
      return json({ ok: true, booking: summary });
    }

    // ===== cancel =====
    if (alreadyCancelled) {
      return json({ ok: true, alreadyCancelled: true, booking: summary });
    }
    if (isPast) {
      return reject("past", "ご予約の時間を過ぎているため、こちらからはキャンセルできません。お手数ですがジムへ直接ご連絡ください。");
    }

    const serviceHeaders = {
      "Content-Type": "application/json",
      "apikey": SERVICE_ROLE,
      "Authorization": `Bearer ${SERVICE_ROLE}`,
    };
    const invokeFn = async (name: string, body: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
          method: "POST",
          headers: serviceHeaders,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        console.log(`[trial-cancel] ${name} status=${res.status} body=${text.slice(0, 160)}`);
        return res.ok;
      } catch (e) {
        console.error(`[trial-cancel] ${name} failed:`, e instanceof Error ? e.message : String(e));
        return false;
      }
    };

    // 1) Google カレンダーのイベントを先に削除 (失敗してもキャンセルは続行)
    if (booking.google_event_id) {
      await invokeFn("google-calendar-sync", {
        action: "delete",
        booking_id: booking.id,
        google_event_id: booking.google_event_id,
        is_trial: true,
      });
    }

    // 2) status を「キャンセル済み」に更新。競合時 (既にキャンセル済み) も冪等に成功扱い。
    const { data: updated, error: uErr } = await admin
      .from("trial_bookings")
      .update({ status: CANCELLED })
      .eq("id", booking.id)
      .neq("status", CANCELLED)
      .select("id")
      .maybeSingle();
    if (uErr) return fail("update", uErr.message);
    if (!updated) {
      // 他経路で既にキャンセル済みになっていた
      return json({ ok: true, alreadyCancelled: true, booking: { ...summary, alreadyCancelled: true } });
    }

    // 3) トレーナーへ通知 — 枠が空いたことを即座に知らせる。
    //    宛先はこのテナントの trainer を優先、居なければ owner (trial-book と同じ解決)。
    const { data: staff } = await admin
      .from("tenant_members")
      .select("user_id, role")
      .eq("tenant_id", booking.tenant_id)
      .in("role", ["trainer", "owner"])
      .eq("status", "active")
      .order("joined_at", { ascending: true });
    const staffRows = staff ?? [];
    const trainerId = (staffRows.find((m) => m.role === "trainer") ?? staffRows[0])?.user_id ?? null;

    if (trainerId) {
      // push (service_role 起動なので user_ids 指定がそのまま通る)
      await invokeFn("send-push-notification", {
        user_ids: [trainerId],
        title: "体験予約がキャンセルされました",
        body: `${booking.guest_name}様 ${dateStr} ${timeStr} の体験予約がキャンセルされました`,
        url: "/",
        tag: `trial-cancel-${booking.id}`,
      });
      // LINE (未連携なら送信側が無視する)
      await invokeFn("send-line-message", {
        user_id: trainerId,
        message: `【${gymName}】体験予約がキャンセルされました。\n\n・お名前：${booking.guest_name} 様\n・日時：${dateStr} ${timeStr}\n\nお客様ご自身によるキャンセルです。枠が空きました。`,
      });
    }

    return json({ ok: true, cancelled: true, booking: { ...summary, status: CANCELLED, alreadyCancelled: true, cancellable: false } });
  } catch (e) {
    console.error("[trial-cancel] unexpected:", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: GENERIC_ERROR }, 500);
  }
});
