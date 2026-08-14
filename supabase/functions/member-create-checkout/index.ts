// お客様が回数券・月謝を買う（Stripe Connect の Direct charges）。
//
// ⚠️ **`Stripe-Account` ヘッダで接続先アカウント上に課金を作る**のが要点。
//    これを付け忘れると、お客様のお金が**ジムではなくプラットフォームに入る**。
//    既存の `create-checkout` はまさにその形なので流用しない。
//
// ## 実ゲートはここ（画面のフラグではない）
//
// `tenants.stripe_charges_enabled` は**画面の出し分け用のヒント**に過ぎない。
// オーナーは既存の tenants UPDATE ポリシーでこの値を書き換えられるので、
// **認可の根拠にしてはいけない**。ここで Stripe に直接問い合わせて
// `charges_enabled` を確認する。

import { createStripeClient, type StripeEnv } from "../_shared/stripe.ts";
import { verifyCaller } from "../_shared/auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // ⚠️ userId は必ず JWT から。body から取ると他人名義の支払いを作れる。
    const caller = await verifyCaller(req);
    if (!caller?.userId) return json({ error: "Unauthorized" }, 401);
    const userId = caller.userId;

    const { planId, environment, successUrl, cancelUrl } = await req.json();
    if (!planId) return json({ error: "Missing planId" }, 400);
    if (environment !== "sandbox" && environment !== "live") return json({ error: "Invalid environment" }, 400);
    if (!successUrl || !cancelUrl) return json({ error: "Missing return urls" }, 400);
    const env: StripeEnv = environment;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 買う人がその店の会員であることを確認する（他店のプランを買えないように）
    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!membership?.tenant_id) return json({ error: "Not a member" }, 403);
    const tenantId = membership.tenant_id as string;

    const { data: tenant } = await admin
      .from("tenants")
      .select("payments_enabled, payment_terms_url")
      .eq("id", tenantId)
      .maybeSingle();
    // 店が明示的にONにしていなければ売らない
    if (!tenant?.payments_enabled) return json({ error: "Payments are not enabled for this gym" }, 403);
    // 特商法の表記が無いまま売らない（売主は店なので店ごとに要る）
    if (!tenant?.payment_terms_url) return json({ error: "Payment terms are not set" }, 403);

    const { data: plan } = await admin
      .from("tenant_plans")
      .select("id, plan_name, tenant_id, is_active")
      .eq("id", planId)
      .maybeSingle();
    if (!plan || plan.tenant_id !== tenantId || plan.is_active === false) {
      return json({ error: "Plan not available" }, 400);
    }

    const { data: price } = await admin
      .from("tenant_plan_prices")
      .select("stripe_price_id, is_active")
      .eq("plan_id", planId)
      .eq("environment", env)
      .maybeSingle();
    if (!price?.stripe_price_id || price.is_active === false) {
      return json({ error: "Price not configured" }, 400);
    }

    const { data: acct } = await admin
      .from("tenant_stripe_accounts")
      .select("stripe_account_id")
      .eq("tenant_id", tenantId)
      .eq("environment", env)
      .maybeSingle();
    if (!acct?.stripe_account_id) return json({ error: "Gym has not connected Stripe" }, 403);
    const accountId = acct.stripe_account_id as string;

    const stripe = createStripeClient(env);

    // ⚠️ **実ゲート。** DB の stripe_charges_enabled は画面用のヒントで、
    //    オーナーが書き換えられる。Stripe に直接聞く。
    const account = await stripe.accounts.retrieve(accountId);
    if (!account.charges_enabled) {
      return json({ error: "This gym cannot accept charges yet" }, 403);
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [{ price: price.stripe_price_id, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        // webhook 側が「誰の・どの店の・どのプラン」を復元するための唯一の手掛かり。
        // ⚠️ ここを落とすと、支払いは成立するのに誰の分か分からなくなる。
        metadata: {
          user_id: userId,
          tenant_id: tenantId,
          plan_id: String(plan.id),
          plan_name: String(plan.plan_name),
        },
      },
      // ⚠️ これが Direct charges の本体。付け忘れるとプラットフォームに入る。
      { stripeAccount: accountId },
    );

    return json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error("member-create-checkout error:", e);
    return json({ error: (e as Error).message }, 400);
  }
});
