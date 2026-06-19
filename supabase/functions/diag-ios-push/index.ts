// Diagnostic-only: send a test FCM v1 message to the latest iOS and Android
// push_devices token, and return full HTTP status + response body for each.
// Safe to delete after debugging. No auth required (verify_jwt = false).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.9.6/index.ts";

async function getAccessToken(sa: { client_email: string; private_key: string; token_uri?: string }) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const pk = await importPKCS8(sa.private_key.replace(/\\n/g, "\n"), "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email).setSubject(sa.client_email)
    .setAudience(tokenUri).setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(pk);
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${text}`);
  return JSON.parse(text).access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const sa = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")!);
    const accessToken = await getAccessToken(sa);

    // latest one device per platform
    const { data: devices } = await supabase
      .from("push_devices")
      .select("id, fcm_token, platform, user_id, created_at")
      .order("created_at", { ascending: false });

    const seen = new Set<string>();
    const pick: typeof devices = [] as never;
    for (const d of devices ?? []) {
      if (!seen.has(d.platform)) {
        seen.add(d.platform);
        (pick as unknown[]).push(d);
      }
      if (seen.size >= 2) break;
    }

    const results: unknown[] = [];
    for (const d of pick as Array<{ id: string; fcm_token: string; platform: string; user_id: string }>) {
      const msg = {
        message: {
          token: d.fcm_token,
          notification: { title: "診断", body: `${d.platform} test` },
          apns: { payload: { aps: { sound: "default", badge: 1 } } },
        },
      };
      const r = await fetch(
        `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(msg),
        },
      );
      const body = await r.text();
      results.push({
        platform: d.platform,
        user_id: d.user_id,
        device_id: d.id,
        token_preview: d.fcm_token.slice(0, 30),
        http_status: r.status,
        ok: r.ok,
        response_body: body,
      });
    }

    return new Response(JSON.stringify({ project_id: sa.project_id, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
