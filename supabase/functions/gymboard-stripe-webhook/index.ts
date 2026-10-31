import { createClient } from "npm:@supabase/supabase-js@2";
import { encode } from "https://deno.land/std@0.168.0/encoding/hex.ts";
import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";
import { PLAN_MAP, FREE_PLAN, isValidLookupKey } from "../_shared/gymboard-plans.ts";

// GymBoard-specific webhook secret (separate from Salute coin webhook).
// Supports either a single secret or test/live separated secrets.
function candidateSecrets(): string[] {
  const arr = [
    Deno.env.get("GYMBOARD_STRIPE_WEBHOOK_SECRET"),
    Deno.env.get("GYMBOARD_STRIPE_WEBHOOK_SECRET_SANDBOX"),
    Deno.env.get("GYMBOARD_STRIPE_WEBHOOK_SECRET_LIVE"),
  ].filter((s): s is string => !!s);
  return arr;
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return new TextDecoder().decode(encode(new Uint8Array(signed)));
}

async function verifyAnySecret(req: Request, body: string): Promise<any | null> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return null;
  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k === "t") timestamp = v;
    if (k === "v1") v1Signatures.push(v);
  }
  if (!timestamp || v1Signatures.length === 0) return null;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return null;

  const secrets = candidateSecrets();
  for (const secret of secrets) {
    const expected = await hmacSha256Hex(secret, `${timestamp}.${body}`);
    if (v1Signatures.includes(expected)) {
      try { return JSON.parse(body); } catch { return null; }
    }
  }
  return null;
}

function getAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * 運営が付ける課金の印（tenant_billing_flags。anon・authenticated は読めない・書けない。
 * supabase/migrations/20261031090000_billing_flags_and_tenant_billing_guard.sql）。
 *
 * - is_comp: コンプ（運営が無償で無制限にしているジム）。Stripe のイベントで**一切書き換えない**。
 *   2026-08-21 に実際に起きた: 運営自身のジム（Salute御所南・コンプ）に課金テストの
 *   サブスクが紐づいたまま Stripe 側で削除され、customer.subscription.deleted が
 *   コンプ状態を free（上限5名）へ上書き。顧客37名のジムが「上限超過」で
 *   新規予約・記録を作れなくなった。
 *   🔴 以前は max_customers IS NULL をコンプとみなしていた。Pro（上限なし）も NULL なので、
 *   Pro になったジムは以後のイベント（解約・プラン変更）を全部無視され、解約しても Pro のまま
 *   残った（2026-10-31 の点検）。コンプは印だけで見分ける。
 *   コンプのジムを本当に課金へ移すときは、先に運営が印を外してから checkout する（checkout は印があると断る）。
 * - stripe_sandbox_allowed: テスト決済を受け付けるテスト用のジム。テストモードのイベント
 *   （livemode = false）は、この印のあるジムにしか反映しない。以前はどのジムのオーナーでも、
 *   テスト用のカード番号（お金が動かない）で Pro にできた（2026-10-31 の点検）。
 *
 * 🔴 印が読めなかったら例外にする（500 → Stripe が後で送り直す）。読めないまま進むと、
 *    コンプのジムを落としてしまう（2026-08-21 と同じ事故）。
 */
async function billingFlags(tenantId: string): Promise<{ comp: boolean; sandboxAllowed: boolean }> {
  const { data, error } = await getAdmin()
    .from("tenant_billing_flags")
    .select("is_comp, stripe_sandbox_allowed")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`tenant_billing_flags read failed: ${error.message}`);
  const row = data as { is_comp: boolean; stripe_sandbox_allowed: boolean } | null;
  return { comp: row?.is_comp === true, sandboxAllowed: row?.stripe_sandbox_allowed === true };
}

/** このイベントをこのジムに反映しない理由（ログ用）。反映してよいなら null。 */
async function skipReason(tenantId: string, livemode: boolean): Promise<string | null> {
  const flags = await billingFlags(tenantId);
  if (flags.comp) return "comp tenant";
  if (!livemode && !flags.sandboxAllowed) return "test-mode event for a tenant that is not a test tenant";
  return null;
}

async function applySubscriptionToTenant(
  tenantId: string,
  subscription: any,
  env: StripeEnv,
  livemode: boolean,
) {
  const skip = await skipReason(tenantId, livemode);
  if (skip) {
    console.log("skip subscription event:", skip, tenantId);
    return;
  }
  const admin = getAdmin();
  const stripe = createStripeClient(env);

  // Resolve lookup_key from the subscription's price
  const priceId = subscription?.items?.data?.[0]?.price?.id as string | undefined;
  let lookupKey: string | null = subscription?.items?.data?.[0]?.price?.lookup_key ?? null;
  if (!lookupKey && priceId) {
    try {
      const price = await stripe.prices.retrieve(priceId);
      lookupKey = (price as any)?.lookup_key ?? null;
    } catch (e) {
      console.error("price retrieve failed", e);
    }
  }
  if (!lookupKey || !isValidLookupKey(lookupKey)) {
    console.error("Unknown lookup_key on subscription", subscription?.id, lookupKey);
    return;
  }
  const def = PLAN_MAP[lookupKey];
  // Newer Stripe API versions move current_period_end from the subscription
  // down to each subscription item. Read item-level first, fall back to the
  // legacy subscription-level field. Guard against empty items arrays.
  const items = subscription?.items?.data;
  const periodEndUnix: number | null =
    (Array.isArray(items) && items.length > 0 && items[0]?.current_period_end) ||
    subscription?.current_period_end ||
    null;
  const currentPeriodEnd = periodEndUnix
    ? new Date(periodEndUnix * 1000).toISOString()
    : null;

  await admin.from("tenants").update({
    gymboard_plan: def.plan,
    gymboard_plan_period: def.period,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    max_customers: def.max_customers,
    max_trainers: def.max_trainers,
    current_period_end: currentPeriodEnd,
  }).eq("id", tenantId);
}

async function resolveTenantId(subscription: any): Promise<string | null> {
  const fromMeta = subscription?.metadata?.tenant_id as string | undefined;
  if (fromMeta) return fromMeta;
  const admin = getAdmin();
  const { data } = await admin
    .from("tenants")
    .select("id")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawEnv = new URL(req.url).searchParams.get("env");
  const env: StripeEnv = rawEnv === "live" ? "live" : "sandbox";

  const body = await req.text();
  const event = await verifyAnySecret(req, body);
  if (!event) return new Response("Invalid signature", { status: 400 });

  try {
    const type = event.type as string;
    const obj = event.data?.object;
    // 本番のイベントか（署名を確かめたあとの値なので信じてよい）。テストモードは false。
    // 値が無い・壊れているときは本番扱いにしない（テスト用のジムにしか反映しない側へ倒す）。
    const livemode = event.livemode === true;

    if (type === "checkout.session.completed") {
      const tenantId = obj?.metadata?.tenant_id as string | undefined;
      const subscriptionId = obj?.subscription as string | undefined;
      if (!tenantId || !subscriptionId) {
        console.error("checkout.session.completed missing tenant_id/subscription", obj?.id);
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
      // 反映しないジムなら、Stripe へ問い合わせる前に止める
      const skip = await skipReason(tenantId, livemode);
      if (skip) {
        console.log("skip checkout.session.completed:", skip, tenantId);
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
      const stripe = createStripeClient(env);
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await applySubscriptionToTenant(tenantId, subscription, env, livemode);
    } else if (type === "customer.subscription.updated" || type === "customer.subscription.created") {
      const tenantId = await resolveTenantId(obj);
      if (!tenantId) {
        console.error("subscription.updated: tenant not found", obj?.id);
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
      await applySubscriptionToTenant(tenantId, obj, env, livemode);
    } else if (type === "customer.subscription.deleted") {
      const tenantId = await resolveTenantId(obj);
      if (!tenantId) return new Response(JSON.stringify({ received: true }), { status: 200 });
      // コンプは落とさない・テストのイベントはテスト用のジムだけ（billingFlags のコメント参照）
      const skip = await skipReason(tenantId, livemode);
      if (skip) {
        console.log("skip subscription.deleted:", skip, tenantId);
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
      await getAdmin().from("tenants").update({
        gymboard_plan: FREE_PLAN.plan,
        gymboard_plan_period: null,
        max_customers: FREE_PLAN.max_customers,
        max_trainers: FREE_PLAN.max_trainers,
        subscription_status: "canceled",
        stripe_subscription_id: null,
        current_period_end: null,
      }).eq("id", tenantId);
    } else if (type === "invoice.payment_failed") {
      const subscriptionId = obj?.subscription as string | undefined;
      if (subscriptionId) {
        const admin = getAdmin();
        const { data } = await admin
          .from("tenants")
          .select("id")
          .eq("stripe_subscription_id", subscriptionId)
          .maybeSingle();
        if ((data as any)?.id) {
          // 支払いの失敗も同じ。コンプ・テストのイベントで本番のジムを past_due にしない
          const skip = await skipReason((data as any).id, livemode);
          if (skip) {
            console.log("skip invoice.payment_failed:", skip, (data as any).id);
            return new Response(JSON.stringify({ received: true }), { status: 200 });
          }
          await admin.from("tenants")
            .update({ subscription_status: "past_due" })
            .eq("id", (data as any).id);
        }
      }
    } else {
      console.log("Unhandled event type:", type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gymboard-stripe-webhook error:", e);
    return new Response("Webhook error", { status: 500 });
  }
}

// どの版が動いているかを外から確かめるための印（署名の無い呼び出しの 400 にも付く。中身は日付だけ）。
// Edge Function は push でも Publish でも出ないので、デプロイの確認に使う（mem/ops/edge-function-deploy.md）。
const BUILD = "2026-10-31-billing-flags";

Deno.serve(async (req) => {
  const res = await handle(req);
  res.headers.set("x-gymboard-build", BUILD);
  return res;
});
