// trial-cancel: 体験予約のお客様セルフキャンセル (認証不要・トークン認可)。
//
// 体験予約はアカウント無しのゲストが作成するため、予約1件ごとの秘密トークン
// (trial_bookings.cancel_token) を「本人の合言葉」として使う。確認メールの
// キャンセルリンクにこのトークンが埋め込まれており、それを知っている＝本人、とみなす。
//
// この関数は「ページ(HTML)」と「API(JSON)」の両方を提供する:
//   - GET  ?token=... … キャンセル確認ページ(HTML)を返す。副作用なし(メールの
//                       プリフェッチで誤ってキャンセルしないよう GET は読み取り専用)。
//   - POST (フォーム)  … 確認ページのボタン送信。実際にキャンセルして結果ページ(HTML)を返す。
//   - POST (JSON)     … 旧来の JSON API ({token, action:"info"|"cancel"})。アプリ内から利用。
//
// メールのリンクを本関数の URL(Supabaseドメイン)に向けることで、フロントエンドの
// 公開状態に依存せず確実に動く(カスタムドメインの配信/キャッシュ問題を回避)。
//
// キャンセル時の処理:
//   1. Google カレンダー連携イベントを削除 (連携時のみ・失敗しても継続)
//   2. status を「キャンセル済み」に更新
//   3. トレーナーへ通知 (push + LINE) — 枠が空いたことを知らせる

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANCELLED = "キャンセル済み";
const GENERIC_ERROR = "サーバーで問題が発生しました。時間をおいて再度お試しください。";

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

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// 非ASCII(日本語)をすべて数値文字参照(&#NNN;)に変換して純ASCIIにする。
// 配信経路やブラウザが文字コードを誤判定(UTF-8をShift_JIS等と解釈)しても、
// 純ASCIIなら文字化けしない。メールの makeEmailHtmlAsciiSafe と同じ考え方。
function asciiSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    out += cp > 0x7f ? `&#${cp};` : ch;
  }
  return out;
}

// ---- HTML ページ生成 ----
function htmlDoc(title: string, inner: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif; background:#eef2f2; color:#1a2b2a; }
  .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
  .card { background:#fff; border-radius:18px; padding:30px 24px; max-width:400px; width:100%; box-shadow:0 8px 30px rgba(0,0,0,.10); text-align:center; }
  .badge { width:60px; height:60px; border-radius:50%; margin:0 auto 16px; display:flex; align-items:center; justify-content:center; }
  .badge svg { width:30px; height:30px; }
  h1 { font-size:20px; margin:0 0 8px; font-weight:700; }
  p { font-size:14px; color:#5a6a69; line-height:1.7; margin:6px 0; }
  .detail { background:#eefbfa; border-radius:12px; padding:16px; margin:18px 0; }
  .detail .dt { font-size:16px; font-weight:700; color:#0f2a29; margin:2px 0; }
  form { margin:18px 0 6px; }
  .btn { display:block; width:100%; background:#40E0D0; color:#0A3D3B; font-size:16px; font-weight:700; border:none; border-radius:12px; padding:15px; cursor:pointer; -webkit-appearance:none; }
  .btn:active { opacity:.85; }
  .muted { font-size:12px; color:#9aa7a6; margin-top:10px; }
  .gym { margin-top:20px; font-size:13px; color:#7a8887; font-weight:700; }
</style>
</head>
<body><div class="wrap"><div class="card">${inner}</div></div></body>
</html>`;
}

const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="#0A7d76" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_CAL_X = `<svg viewBox="0 0 24 24" fill="none" stroke="#d14343" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="10" y1="15" x2="14" y2="19"/><line x1="14" y1="15" x2="10" y2="19"/></svg>`;
const ICON_ALERT = `<svg viewBox="0 0 24 24" fill="none" stroke="#8a9796" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

function badge(bg: string, icon: string): string {
  return `<div class="badge" style="background:${bg}">${icon}</div>`;
}
function detailBlock(dateStr: string, timeStr: string): string {
  return `<div class="detail"><div class="dt">${escapeHtml(dateStr)}</div><div class="dt">${escapeHtml(timeStr)}</div></div>`;
}
function gymLine(gymName: string): string {
  return `<div class="gym">${escapeHtml(gymName)}</div>`;
}

function pageConfirm(token: string, gymName: string, dateStr: string, timeStr: string): string {
  return htmlDoc("予約のキャンセル", `
    ${badge("#fdecec", ICON_CAL_X)}
    <h1>予約をキャンセルしますか？</h1>
    <p>下記の初回無料体験のご予約をキャンセルします。</p>
    ${detailBlock(dateStr, timeStr)}
    <form method="POST" action="?token=${encodeURIComponent(token)}">
      <button class="btn" type="submit">この予約をキャンセルする</button>
    </form>
    <p class="muted">キャンセルしない場合は、このページを閉じてください。</p>
    ${gymLine(gymName)}
  `);
}
function pageSuccess(gymName: string, dateStr: string, timeStr: string, already: boolean): string {
  return htmlDoc(already ? "キャンセル済み" : "キャンセルしました", `
    ${badge("#e6f7f5", ICON_CHECK)}
    <h1>${already ? "すでにキャンセル済みです" : "キャンセルしました"}</h1>
    <p>${already ? "このご予約はすでにキャンセルされています。" : "ご予約のキャンセルを承りました。またのご利用をお待ちしております。"}</p>
    ${detailBlock(dateStr, timeStr)}
    <p class="muted">改めてご予約される場合は、体験予約ページからお申し込みください。</p>
    ${gymLine(gymName)}
  `);
}
function pagePast(gymName: string, dateStr: string, timeStr: string): string {
  return htmlDoc("予約時間を過ぎています", `
    ${badge("#f0f2f2", ICON_ALERT)}
    <h1>予約時間を過ぎています</h1>
    <p>ご予約の時間を過ぎているため、こちらからはキャンセルできません。お手数ですがジムへ直接ご連絡ください。</p>
    ${detailBlock(dateStr, timeStr)}
    ${gymLine(gymName)}
  `);
}
function pageError(): string {
  return htmlDoc("予約が見つかりません", `
    ${badge("#f0f2f2", ICON_ALERT)}
    <h1>予約が見つかりません</h1>
    <p>キャンセル用のリンクが正しくないか、有効期限が切れています。お手数ですがジムへ直接ご連絡ください。</p>
  `);
}
function htmlResponse(html: string, status = 200): Response {
  // 本文は asciiSafe で純ASCII化済みのため charset 指定は不要。
  // Content-Type に charset パラメータを付けると一部ゲートウェイがヘッダを落として
  // text/plain 扱い(=ブラウザがソースを素のテキスト表示)になることがあるため、
  // 動作実績のある image/png と同じく「パラメータ無しの型のみ」で返す。
  return new Response(asciiSafe(html), {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html" },
  });
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type LookupResult = {
  booking: any;
  gymName: string;
  dateStr: string;
  timeStr: string;
  alreadyCancelled: boolean;
  isPast: boolean;
};

async function lookupByToken(admin: any, token: string): Promise<LookupResult | null> {
  const { data: booking, error } = await admin
    .from("trial_bookings")
    .select("id, tenant_id, guest_name, booking_date, status, google_event_id, tenants(gym_name)")
    .eq("cancel_token", token)
    .maybeSingle();
  if (error) {
    console.error("[trial-cancel] lookup failed:", error.message);
    return null;
  }
  if (!booking) return null;
  const tenantRel = (booking as any).tenants;
  const gymName = (Array.isArray(tenantRel) ? tenantRel[0]?.gym_name : tenantRel?.gym_name) || "ジム";
  const { dateStr, timeStr } = formatJst(booking.booking_date as string);
  return {
    booking,
    gymName,
    dateStr,
    timeStr,
    alreadyCancelled: booking.status === CANCELLED,
    isPast: new Date(booking.booking_date as string).getTime() <= Date.now(),
  };
}

// 実際のキャンセル処理。冪等 (既にキャンセル済みなら alreadyCancelled:true)。
async function performCancel(
  admin: any,
  SUPABASE_URL: string,
  SERVICE_ROLE: string,
  info: LookupResult,
): Promise<{ cancelled: boolean; alreadyCancelled: boolean }> {
  const { booking, gymName, dateStr, timeStr } = info;

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

  // 2) status を「キャンセル済み」に更新。競合時も冪等。
  const { data: updated, error: uErr } = await admin
    .from("trial_bookings")
    .update({ status: CANCELLED })
    .eq("id", booking.id)
    .neq("status", CANCELLED)
    .select("id")
    .maybeSingle();
  if (uErr) {
    console.error("[trial-cancel] update failed:", uErr.message);
    throw new Error(uErr.message);
  }
  if (!updated) return { cancelled: false, alreadyCancelled: true };

  // 3) トレーナーへ通知 (push + LINE)。宛先は trainer 優先、次に owner。
  const { data: staff } = await admin
    .from("tenant_members")
    .select("user_id, role")
    .eq("tenant_id", booking.tenant_id)
    .in("role", ["trainer", "owner"])
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  const staffRows = staff ?? [];
  const trainerId = (staffRows.find((m: any) => m.role === "trainer") ?? staffRows[0])?.user_id ?? null;
  if (trainerId) {
    await invokeFn("send-push-notification", {
      user_ids: [trainerId],
      title: "体験予約がキャンセルされました",
      body: `${booking.guest_name}様 ${dateStr} ${timeStr} の体験予約がキャンセルされました`,
      url: "/",
      tag: `trial-cancel-${booking.id}`,
    });
    await invokeFn("send-line-message", {
      user_id: trainerId,
      message: `【${gymName}】体験予約がキャンセルされました。\n\n・お名前：${booking.guest_name} 様\n・日時：${dateStr} ${timeStr}\n\nお客様ご自身によるキャンセルです。枠が空きました。`,
    });
  }
  return { cancelled: true, alreadyCancelled: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const url = new URL(req.url);

  try {
    // ===== GET: キャンセル確認ページ(HTML)。副作用なし =====
    if (req.method === "GET") {
      const token = (url.searchParams.get("token") ?? "").trim();
      if (!UUID_RE.test(token)) return htmlResponse(pageError());
      const info = await lookupByToken(admin, token);
      if (!info) return htmlResponse(pageError());
      if (info.alreadyCancelled) return htmlResponse(pageSuccess(info.gymName, info.dateStr, info.timeStr, true));
      if (info.isPast) return htmlResponse(pagePast(info.gymName, info.dateStr, info.timeStr));
      return htmlResponse(pageConfirm(token, info.gymName, info.dateStr, info.timeStr));
    }

    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") ?? "";

      // ===== POST(JSON): 旧来の API (アプリ内から利用) =====
      if (contentType.includes("application/json")) {
        let payload: { token?: unknown; action?: unknown };
        try {
          payload = await req.json();
        } catch {
          return json({ ok: false, code: "validation", error: "リクエストの形式が正しくありません。" });
        }
        const token = String(payload.token ?? "").trim();
        const action = String(payload.action ?? "info").trim();
        if (!UUID_RE.test(token)) return json({ ok: false, code: "invalid_token", error: "キャンセル用のリンクが正しくありません。" });
        const info = await lookupByToken(admin, token);
        if (!info) return json({ ok: false, code: "invalid_token", error: "キャンセル用のリンクが正しくありません。" });
        const summary = {
          guestName: info.booking.guest_name,
          gymName: info.gymName,
          date: info.dateStr,
          time: info.timeStr,
          status: info.booking.status,
          alreadyCancelled: info.alreadyCancelled,
          isPast: info.isPast,
          cancellable: !info.alreadyCancelled && !info.isPast,
        };
        if (action !== "cancel") return json({ ok: true, booking: summary });
        if (info.alreadyCancelled) return json({ ok: true, alreadyCancelled: true, booking: summary });
        if (info.isPast) return json({ ok: false, code: "past", error: "ご予約の時間を過ぎているため、こちらからはキャンセルできません。お手数ですがジムへ直接ご連絡ください。" });
        const r = await performCancel(admin, SUPABASE_URL, SERVICE_ROLE, info);
        return json({ ok: true, cancelled: r.cancelled, alreadyCancelled: r.alreadyCancelled, booking: { ...summary, status: CANCELLED, alreadyCancelled: true, cancellable: false } });
      }

      // ===== POST(フォーム): 確認ページのボタン送信 → キャンセルして結果ページ(HTML) =====
      const token = (url.searchParams.get("token") ?? "").trim();
      if (!UUID_RE.test(token)) return htmlResponse(pageError());
      const info = await lookupByToken(admin, token);
      if (!info) return htmlResponse(pageError());
      if (info.alreadyCancelled) return htmlResponse(pageSuccess(info.gymName, info.dateStr, info.timeStr, true));
      if (info.isPast) return htmlResponse(pagePast(info.gymName, info.dateStr, info.timeStr));
      const r = await performCancel(admin, SUPABASE_URL, SERVICE_ROLE, info);
      return htmlResponse(pageSuccess(info.gymName, info.dateStr, info.timeStr, r.alreadyCancelled));
    }

    return json({ ok: false, error: "Method not allowed" }, 405);
  } catch (e) {
    console.error("[trial-cancel] unexpected:", e instanceof Error ? e.message : String(e));
    // GET/フォーム経路なら HTML、それ以外は JSON でエラーを返す
    const wantsHtml = req.method === "GET" || !(req.headers.get("content-type") ?? "").includes("application/json");
    if (wantsHtml) return htmlResponse(htmlDoc("エラー", `${badge("#f0f2f2", ICON_ALERT)}<h1>エラーが発生しました</h1><p>時間をおいて再度お試しください。</p>`), 500);
    return json({ ok: false, error: GENERIC_ERROR }, 500);
  }
});
