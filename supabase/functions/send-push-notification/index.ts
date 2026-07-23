import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { verifyCaller, hasRole } from "../_shared/auth.ts";

// 'app.gymboard.app' は DNS 未設定で存在しないドメインだったため、実際に生きている
// 本番ドメイン 'app.kyoto-salute.com' に修正済み（2026-07）。
const ALLOWED_URL_HOSTS = new Set([
  "app.kyoto-salute.com",
  "gymboard.lovable.app",
]);

function isAllowedUrl(u: string | undefined): boolean {
  if (!u) return true;
  if (u.startsWith("/")) return true;
  try {
    const parsed = new URL(u);
    return ALLOWED_URL_HOSTS.has(parsed.host);
  } catch {
    return false;
  }
}

// ============================================================
// Web Push (VAPID) helpers — unchanged behavior
// ============================================================
const VAPID_PUBLIC_KEY = "BKxLbT912uBVUI_0010w-QQWaic5ITY-_SZS1wo9BZdTq6mTyfbBPlmftYG_CKB4cdJYPTSLhiEGADA3Uv_R5_s";

function base64UrlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importVapidKey(privateKeyBase64Url: string): Promise<CryptoKey> {
  const rawKey = base64UrlDecode(privateKeyBase64Url);
  const pkcs8 = new Uint8Array([
    0x30, 0x81, 0x87, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86,
    0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x03, 0x01, 0x07, 0x04, 0x6d, 0x30, 0x6b, 0x02, 0x01, 0x01, 0x04, 0x20,
    ...rawKey,
    0xa1, 0x44, 0x03, 0x42, 0x00,
    ...base64UrlDecode(VAPID_PUBLIC_KEY),
  ]);
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function createVapidAuthHeader(endpoint: string, privateKey: string): Promise<{ authorization: string; cryptoKey: string }> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 12 * 3600;
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: expiry, sub: "mailto:info@salute-gosyominami.com" };
  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;
  const key = await importVapidKey(privateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key,
    new TextEncoder().encode(unsignedToken),
  );
  const sigBytes = new Uint8Array(signature);
  let r: Uint8Array, s: Uint8Array;
  if (sigBytes.length === 64) {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32);
  } else {
    const rLen = sigBytes[3];
    const rStart = 4;
    r = sigBytes.slice(rStart, rStart + rLen);
    const sLen = sigBytes[rStart + rLen + 1];
    const sStart = rStart + rLen + 2;
    s = sigBytes.slice(sStart, sStart + sLen);
    if (r.length > 32) r = r.slice(r.length - 32);
    if (s.length > 32) s = s.slice(s.length - 32);
  }
  const rPad = new Uint8Array(32);
  rPad.set(r, 32 - r.length);
  const sPad = new Uint8Array(32);
  sPad.set(s, 32 - s.length);
  const rawSig = new Uint8Array(64);
  rawSig.set(rPad, 0);
  rawSig.set(sPad, 32);
  const jwt = `${unsignedToken}.${base64UrlEncode(rawSig.buffer)}`;
  return {
    authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
    cryptoKey: `p256ecdsa=${VAPID_PUBLIC_KEY}`,
  };
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidPrivateKey: string,
): Promise<Response> {
  const { authorization, cryptoKey } = await createVapidAuthHeader(subscription.endpoint, vapidPrivateKey);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Crypto-Key": cryptoKey,
      "Content-Type": "application/json",
      TTL: "86400",
    },
    body: payload,
  });
}

// ============================================================
// FCM HTTP v1 API helpers
// ============================================================
type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
};

let cachedServiceAccount: ServiceAccount | null = null;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function getServiceAccount(): ServiceAccount | null {
  if (cachedServiceAccount) return cachedServiceAccount;
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing required fields");
      return null;
    }
    cachedServiceAccount = parsed;
    return parsed;
  } catch (e) {
    console.error("FIREBASE_SERVICE_ACCOUNT_JSON parse failed:", e);
    return null;
  }
}

async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt - 60 > now) {
    return cachedAccessToken.token;
  }
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const privateKey = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`FCM token exchange failed: ${res.status} ${errText}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600),
  };
  return data.access_token;
}

async function sendFcm(
  accessToken: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<{ ok: boolean; status: number; errorCode?: string; errorBody?: string }> {
  const message = {
    message: {
      token,
      notification: { title, body },
      data,
      apns: {
        payload: {
          aps: { sound: "default", badge: 1 },
        },
      },
    },
  };
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    },
  );
  if (res.ok) return { ok: true, status: res.status };
  const errBody = await res.text();
  let errorCode: string | undefined;
  try {
    const parsed = JSON.parse(errBody);
    errorCode = parsed?.error?.details?.find?.((d: { errorCode?: string }) => d.errorCode)?.errorCode
      ?? parsed?.error?.status;
  } catch { /* ignore */ }
  return { ok: false, status: res.status, errorCode, errorBody: errBody };
}

// ============================================================
// Main handler
// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

    const payloadJson = await req.json().catch(() => ({}));
    const { purpose, trial_booking_id, url } = payloadJson;
    let { title, body, tag, user_ids } = payloadJson;

    if (!isAllowedUrl(url)) {
      return new Response(JSON.stringify({ error: "Invalid url" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap free-form text fields to prevent abuse if these are forwarded
    // straight to push providers. Title/body remain client-supplied on the
    // authenticated path (legacy contract). The anonymous trial_booking path
    // below overrides these with server-generated text.
    if (typeof title === "string" && title.length > 120) {
      return new Response(JSON.stringify({ error: "title too long" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof body === "string" && body.length > 500) {
      return new Response(JSON.stringify({ error: "body too long" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof tag === "string" && tag.length > 120) {
      return new Response(JSON.stringify({ error: "tag too long" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // ---- Anonymous-allowed path: notify trainers of a new trial booking.
    if (purpose === "trial_booking") {
      if (!trial_booking_id || typeof trial_booking_id !== "string") {
        return new Response(JSON.stringify({ error: "trial_booking_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: trial } = await adminClient
        .from("trial_bookings")
        .select("id, tenant_id, guest_name, booking_date, booking_kind")
        .eq("id", trial_booking_id)
        .maybeSingle();
      if (!trial) {
        return new Response(JSON.stringify({ error: "trial booking not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ---- Idempotency: skip if a recent send already happened for this trial.
      const idempotencyKey = `trial-${trial.id}`;
      const { data: existingDedupe } = await adminClient
        .from("notification_dedupe")
        .select("idempotency_key, sent_at")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingDedupe?.sent_at) {
        const ageMs = Date.now() - new Date(existingDedupe.sent_at as string).getTime();
        if (ageMs < 10 * 60 * 1000) {
          return new Response(
            JSON.stringify({ sent: 0, skipped: true, reason: "duplicate" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      // Reserve the key now to prevent races; refresh sent_at on upsert.
      await adminClient
        .from("notification_dedupe")
        .upsert({ idempotency_key: idempotencyKey, sent_at: new Date().toISOString() });

      // ---- Server-generated, fixed text (ignore any client-supplied values).
      const dt = new Date(trial.booking_date as string);
      const fmt = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
      const when = fmt.format(dt);
      const safeName = String(trial.guest_name ?? "ゲスト").slice(0, 40);
      const isDropIn = trial.booking_kind === "drop_in";
      title = isDropIn ? "新しいドロップイン予約（¥8,000）" : "新しい体験予約";
      body = isDropIn
        ? `${safeName}様 ${when} にドロップイン予約(¥8,000)が入りました`
        : `${safeName}様 ${when} に体験予約が入りました`;
      tag = idempotencyKey;

      const { data: members } = await adminClient
        .from("tenant_members")
        .select("user_id, role")
        .eq("tenant_id", trial.tenant_id)
        .in("role", ["trainer", "owner"]);
      user_ids = (members ?? []).map((m: { user_id: string }) => m.user_id);
      if (user_ids.length === 0) {
        return new Response(JSON.stringify({ sent: 0, message: "No trainers" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (purpose === "waitlist_slot_freed") {
      // ---- 認証必須: 予約キャンセルで空いた枠を、その枠のキャンセル待ちへ通知 ----
      // 受信者はサーバー側で booking_waitlist から解決する（RLSにより顧客の
      // クライアントからは他人の待機行を読めないため）。本文もサーバー生成。
      const caller = await verifyCaller(req);
      if (!caller) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { tenant_id, booking_date } = payloadJson;
      if (!tenant_id || typeof tenant_id !== "string" || !booking_date || typeof booking_date !== "string") {
        return new Response(JSON.stringify({ error: "tenant_id and booking_date required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const cancelledAt = new Date(booking_date);
      if (Number.isNaN(cancelledAt.getTime())) {
        return new Response(JSON.stringify({ error: "invalid booking_date" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // 呼び出し元がそのテナントの所属（顧客 or トレーナー）であること
      if (!caller.isServiceRole) {
        const isTrainer = caller.userId ? await hasRole(caller.userId, "trainer") : false;
        if (!isTrainer) {
          const { data: prof } = await adminClient
            .from("profiles")
            .select("tenant_id")
            .eq("user_id", caller.userId!)
            .maybeSingle();
          if (!prof || prof.tenant_id !== tenant_id) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }

      // JST の日付キーと開始時刻（分）
      const jst = new Date(cancelledAt.getTime() + 9 * 3600 * 1000);
      const pad2 = (n: number) => String(n).padStart(2, "0");
      const dateKey = `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
      const cancelledMin = jst.getUTCHours() * 60 + jst.getUTCMinutes();

      // その日のキャンセル待ちと、キャンセル後も残っている予約を取得
      const dayStart = new Date(`${dateKey}T00:00:00+09:00`).toISOString();
      const dayEnd = new Date(`${dateKey}T23:59:59+09:00`).toISOString();
      const [waitRes, remainRes] = await Promise.all([
        adminClient
          .from("booking_waitlist")
          .select("user_id, start_time")
          .eq("tenant_id", tenant_id)
          .eq("booking_date", dateKey),
        adminClient
          .from("bookings")
          .select("booking_date")
          .eq("tenant_id", tenant_id)
          .eq("status", "予約済み")
          .gte("booking_date", dayStart)
          .lte("booking_date", dayEnd),
      ]);
      const toMin = (t: string) => {
        const [h, m] = String(t).split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
      };
      const remainingMins = (remainRes.data ?? []).map((r: { booking_date: string }) => {
        const j = new Date(new Date(r.booking_date).getTime() + 9 * 3600 * 1000);
        return j.getUTCHours() * 60 + j.getUTCMinutes();
      });
      // 「空いたか」は DB トリガー check_booking_overlap と同じ 75 分間隔で判定:
      // 今回キャンセルされた枠の近傍で、かつ残りの予約では埋まっていない待機だけ通知
      const WINDOW = 75;
      const freed = (waitRes.data ?? []).filter((w: { user_id: string; start_time: string }) => {
        const m = toMin(w.start_time);
        if (Math.abs(m - cancelledMin) >= WINDOW) return false;
        return !remainingMins.some((b: number) => Math.abs(m - b) < WINDOW);
      });
      user_ids = [...new Set(freed.map((w: { user_id: string }) => w.user_id))];
      if (user_ids.length === 0) {
        return new Response(JSON.stringify({ sent: 0, message: "No waitlist match" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 冪等: 同一枠の連続通知を10分抑止（trial_booking と同じ仕組み）
      const hhmm = `${pad2(Math.floor(cancelledMin / 60))}:${pad2(cancelledMin % 60)}`;
      const idempotencyKey = `waitlist-${tenant_id}-${dateKey}-${hhmm}`;
      const { data: existingDedupe } = await adminClient
        .from("notification_dedupe")
        .select("idempotency_key, sent_at")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existingDedupe?.sent_at) {
        const ageMs = Date.now() - new Date(existingDedupe.sent_at as string).getTime();
        if (ageMs < 10 * 60 * 1000) {
          return new Response(JSON.stringify({ sent: 0, skipped: true, reason: "duplicate" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      await adminClient
        .from("notification_dedupe")
        .upsert({ idempotency_key: idempotencyKey, sent_at: new Date().toISOString() });

      // サーバー生成の固定文言（クライアント指定は無視）
      title = "キャンセル待ちの枠に空きが出ました";
      body = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${hhmm}前後の枠に空きが出ました。先着順のためお早めにご予約ください`;
      tag = idempotencyKey;
    } else {
      // ---- Authenticated path ----
      const caller = await verifyCaller(req);
      if (!caller) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
        return new Response(JSON.stringify({ error: "user_ids required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!caller.isServiceRole) {
        const isTrainer = caller.userId ? await hasRole(caller.userId, "trainer") : false;
        if (!isTrainer) {
          const callerId = caller.userId!;
          // Customers may push to themselves or to verified trainers (single-tenant gym).
          // Trainer users are tracked in user_roles, NOT necessarily in tenant_members,
          // so we authoritatively check has_role per target.
          const otherIds: string[] = (user_ids as string[]).filter((id) => id !== callerId);
          if (otherIds.length > 0) {
            const checks = await Promise.all(otherIds.map((id) => hasRole(id, "trainer")));
            const denied = otherIds.filter((_, i) => !checks[i]);
            if (denied.length > 0) {
              return new Response(JSON.stringify({ error: "Forbidden", denied }), {
                status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }
        }
      }
    }


    // ---- Load both delivery targets in parallel ----
    const [webRes, nativeRes] = await Promise.all([
      adminClient
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth, user_id")
        .in("user_id", user_ids),
      adminClient
        .from("push_devices")
        .select("id, fcm_token, platform, user_id")
        .in("user_id", user_ids),
    ]);
    if (webRes.error) throw webRes.error;
    if (nativeRes.error) throw nativeRes.error;

    const subscriptions = webRes.data ?? [];
    const devices = (nativeRes.data ?? []).filter((d: { fcm_token: string | null }) => !!d.fcm_token);

    const notifTitle = title || "お知らせ";
    const notifBody = body || "新しい通知があります";
    const notifUrl = url || "/";
    const notifTag = tag || "default";


    const webPayload = JSON.stringify({
      title: notifTitle, body: notifBody, url: notifUrl, tag: notifTag,
    });

    // ---- Web Push tasks ----
    const webTasks = subscriptions.map((sub) =>
      sendWebPush(sub, webPayload, vapidPrivateKey)
        .then((r) => ({ kind: "web" as const, sub, response: r as Response, error: null as unknown }))
        .catch((e) => ({ kind: "web" as const, sub, response: null, error: e })),
    );

    // ---- FCM tasks ----
    const sa = getServiceAccount();
    let fcmTasks: Promise<{
      kind: "fcm";
      device: { id: string; fcm_token: string; user_id: string };
      result: Awaited<ReturnType<typeof sendFcm>> | null;
      error: unknown;
    }>[] = [];
    if (devices.length > 0) {
      if (!sa) {
        console.warn("push_devices found but FIREBASE_SERVICE_ACCOUNT_JSON missing — skipping FCM");
      } else {
        try {
          const accessToken = await getFcmAccessToken(sa);
          fcmTasks = devices.map((d) =>
            sendFcm(accessToken, sa.project_id, d.fcm_token, notifTitle, notifBody, { url: notifUrl, tag: notifTag })
              .then((result) => ({ kind: "fcm" as const, device: d, result, error: null as unknown }))
              .catch((e) => ({ kind: "fcm" as const, device: d, result: null, error: e })),
          );
        } catch (e) {
          console.error("FCM access token fetch failed:", e);
        }
      }
    }

    const [webResults, fcmResults] = await Promise.all([
      Promise.allSettled(webTasks),
      Promise.allSettled(fcmTasks),
    ]);

    // ---- Tally Web Push ----
    let webSent = 0;
    const expiredEndpoints: string[] = [];
    webResults.forEach((r) => {
      if (r.status !== "fulfilled") return;
      const { response, sub, error } = r.value;
      if (error) { console.warn("web push error:", error); return; }
      if (!response) return;
      if (response.ok) {
        webSent++;
      } else if (response.status === 404 || response.status === 410) {
        expiredEndpoints.push(sub.endpoint);
        console.log(`web push expired (${response.status}) endpoint=${sub.endpoint}`);
      } else {
        console.warn(`web push failed status=${response.status}`);
      }
    });

    // ---- Tally FCM ----
    let fcmSent = 0;
    const invalidDeviceIds: string[] = [];
    fcmResults.forEach((r) => {
      if (r.status !== "fulfilled") return;
      const { device, result, error } = r.value;
      if (error) { console.warn(`fcm error device=${device.id}:`, error); return; }
      if (!result) return;
      if (result.ok) {
        fcmSent++;
      } else {
        const code = result.errorCode ?? "";
        const isInvalid =
          result.status === 404 ||
          code === "UNREGISTERED" ||
          code === "INVALID_ARGUMENT" ||
          code === "NOT_FOUND";
        console.warn(`fcm failed device=${device.id} status=${result.status} code=${code} body=${result.errorBody?.slice(0, 300)}`);
        if (isInvalid) invalidDeviceIds.push(device.id);
      }
    });

    // ---- Cleanup (fire-and-forget) ----
    if (expiredEndpoints.length > 0) {
      adminClient.from("push_subscriptions").delete().in("endpoint", expiredEndpoints)
        .then(({ error: delErr }) => {
          if (delErr) console.warn("expired web subscription cleanup failed:", delErr.message);
          else console.log(`Cleaned up ${expiredEndpoints.length} expired web subscription(s)`);
        });
    }
    if (invalidDeviceIds.length > 0) {
      adminClient.from("push_devices").delete().in("id", invalidDeviceIds)
        .then(({ error: delErr }) => {
          if (delErr) console.warn("invalid fcm device cleanup failed:", delErr.message);
          else console.log(`Cleaned up ${invalidDeviceIds.length} invalid fcm device(s)`);
        });
    }

    const totalSent = webSent + fcmSent;
    const totalTargets = subscriptions.length + devices.length;
    return new Response(
      JSON.stringify({
        sent: totalSent,
        total: totalTargets,
        web: { sent: webSent, total: subscriptions.length, expired: expiredEndpoints.length },
        fcm: { sent: fcmSent, total: devices.length, invalid: invalidDeviceIds.length },
        // Keep top-level "expired" for backwards compatibility with existing callers
        expired: expiredEndpoints.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Push notification error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
