import { createClient } from "npm:@supabase/supabase-js@2";
import { createStripeClient } from "../_shared/stripe.ts";
import {
  PLAN_MAP,
  isValidLookupKey,
  isUuid,
  isValidEnvironment,
} from "../_shared/gymboard-plans.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function bad(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return bad("Unauthorized", 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
    if (authErr || !claims?.claims) return bad("Unauthorized", 401);
    const userId = claims.claims.sub as string;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return bad("Invalid body");
    const { tenant_id, lookup_key, environment, success_url, cancel_url } = body as Record<string, unknown>;

    if (!isUuid(tenant_id)) return bad("Invalid tenant_id");
    if (typeof lookup_key !== "string" || !isValidLookupKey(lookup_key)) return bad("Invalid lookup_key");
    if (!isValidEnvironment(environment)) return bad("Invalid environment");
    if (typeof success_url !== "string" || typeof cancel_url !== "string") return bad("Missing URLs");

    // URL whitelist: only own domains
    const allowedExactHosts = new Set(["localhost", "127.0.0.1"]);
    const allowedSuffixes = [".lovable.app", ".lovableproject.com", ".lovable.dev", ".kyoto-salute.com"];
    for (const u of [success_url, cancel_url]) {
      try {
        const url = new URL(u);
        const ok = allowedExactHosts.has(url.hostname)
          || allowedSuffixes.some((s) => url.hostname.endsWith(s));
        if (!ok) {
          console.error("URL not allowed:", url.hostname);
          return bad("URL not allowed");
        }
      } catch {
        return bad("Invalid URL");
      }
    }

    // Owner check
    const { data: member, error: memErr } = await supabase
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (memErr || !member || (member as any).role !== "owner") return bad("Forbidden", 403);

    // Service-role client to write stripe_customer_id (RLS bypass)
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tenant, error: tenantErr } = await admin
      .from("tenants")
      .select("id, gym_name, email, stripe_customer_id")
      .eq("id", tenant_id)
      .maybeSingle();
    if (tenantErr || !tenant) return bad("Tenant not found", 404);

    const stripe = createStripeClient(environment);

    let customerId = (tenant as any).stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: (tenant as any).gym_name || undefined,
        email: (tenant as any).email || undefined,
        metadata: { tenant_id: tenant_id as string },
      });
      customerId = customer.id;
      await admin.from("tenants").update({ stripe_customer_id: customerId }).eq("id", tenant_id);
    }

    const prices = await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1, active: true });
    if (!prices.data.length) return bad("Price not found for lookup_key", 404);
    const price = prices.data[0];

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: price.id, quantity: 1 }],
      success_url,
      cancel_url,
      metadata: { tenant_id: tenant_id as string, lookup_key },
      subscription_data: {
        metadata: { tenant_id: tenant_id as string, lookup_key },
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gymboard-create-checkout error:", e);
    return bad("Checkout creation failed", 500);
  }
});
