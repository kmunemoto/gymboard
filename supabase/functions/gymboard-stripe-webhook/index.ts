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

async function applySubscriptionToTenant(
  tenantId: string,
  subscription: any,
  env: StripeEnv,
) {
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawEnv = new URL(req.url).searchParams.get("env");
  const env: StripeEnv = rawEnv === "live" ? "live" : "sandbox";

  const body = await req.text();
  const event = await verifyAnySecret(req, body);
  if (!event) return new Response("Invalid signature", { status: 400 });

  try {
    const type = event.type as string;
    const obj = event.data?.object;

    if (type === "checkout.session.completed") {
      const tenantId = obj?.metadata?.tenant_id as string | undefined;
      const subscriptionId = obj?.subscription as string | undefined;
      if (!tenantId || !subscriptionId) {
        console.error("checkout.session.completed missing tenant_id/subscription", obj?.id);
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
      const stripe = createStripeClient(env);
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await applySubscriptionToTenant(tenantId, subscription, env);
    } else if (type === "customer.subscription.updated" || type === "customer.subscription.created") {
      const tenantId = await resolveTenantId(obj);
      if (!tenantId) {
        console.error("subscription.updated: tenant not found", obj?.id);
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }
      await applySubscriptionToTenant(tenantId, obj, env);
    } else if (type === "customer.subscription.deleted") {
      const tenantId = await resolveTenantId(obj);
      if (!tenantId) return new Response(JSON.stringify({ received: true }), { status: 200 });
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
});
