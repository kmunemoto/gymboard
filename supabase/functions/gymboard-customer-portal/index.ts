import { createClient } from "npm:@supabase/supabase-js@2";
import { createStripeClient } from "../_shared/stripe.ts";
import { isUuid, isValidEnvironment } from "../_shared/gymboard-plans.ts";

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
    const { tenant_id, return_url, environment } = body as Record<string, unknown>;

    if (!isUuid(tenant_id)) return bad("Invalid tenant_id");
    if (!isValidEnvironment(environment)) return bad("Invalid environment");
    if (typeof return_url !== "string") return bad("Missing return_url");

    try {
      const url = new URL(return_url);
      const host = url.hostname;
      const allowed =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host.endsWith(".lovable.app") ||
        host.endsWith(".lovable.dev") ||
        host.endsWith(".lovableproject.com") ||
        host === "kyoto-salute.com" ||
        host.endsWith(".kyoto-salute.com");
      if (!allowed) {
        console.warn("gymboard-customer-portal: rejected return_url host:", host);
        return bad("URL not allowed");
      }
    } catch {
      return bad("Invalid return_url");
    }

    // Owner check
    const { data: member } = await supabase
      .from("tenant_members")
      .select("role")
      .eq("tenant_id", tenant_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member || (member as any).role !== "owner") return bad("Forbidden", 403);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: tenant } = await admin
      .from("tenants")
      .select("stripe_customer_id")
      .eq("id", tenant_id)
      .maybeSingle();
    const customerId = (tenant as any)?.stripe_customer_id as string | null;
    if (!customerId) return bad("No subscription customer for this tenant", 404);

    const stripe = createStripeClient(environment);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });

    return new Response(JSON.stringify({ url: portal.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("gymboard-customer-portal error:", e);
    return bad("Portal creation failed", 500);
  }
});
