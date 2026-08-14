// 店（オーナー）が自分の Stripe アカウントを接続する。
//
// Stripe Connect Standard を使い、**お客様のお金は一度もプラットフォームを通らない**
// （Direct charges）。売主・返金責任・特商法の表示義務・回数券の発行者が全て各ジムになる。
//
// ⚠️ **`create-checkout` を流用してはいけない。** あれはテナントの概念が無く、
//    プラットフォーム口座に課金する（＝お客様のお金がジムボードに入る）。
//
// この関数がやること:
//   1. 呼び出し元が「その店の owner」であることを JWT から確認する
//   2. まだ接続していなければ Connect アカウントを作る
//   3. オンボーディング用の一時URL（Account Link）を返す
//
// ⚠️ 返す URL は**数分で失効する使い捨て**。保存しないこと。

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
    // ⚠️ user は必ず JWT から取る。body の user_id を信じると他人の店を接続できる。
    const caller = await verifyCaller(req);
    if (!caller?.userId) return json({ error: "Unauthorized" }, 401);

    const { environment, returnUrl, refreshUrl } = await req.json();
    if (environment !== "sandbox" && environment !== "live") return json({ error: "Invalid environment" }, 400);
    if (!returnUrl || !refreshUrl) return json({ error: "Missing return/refresh url" }, 400);
    const env: StripeEnv = environment;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ⚠️ **owner だけ。** trainer に接続させると、コーチが売上の受け取り先を変えられる。
    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_id, role")
      .eq("user_id", caller.userId)
      .eq("role", "owner")
      .eq("status", "active")
      .maybeSingle();
    if (!membership?.tenant_id) return json({ error: "Owner only" }, 403);
    const tenantId = membership.tenant_id as string;

    const stripe = createStripeClient(env);

    const { data: existing } = await admin
      .from("tenant_stripe_accounts")
      .select("stripe_account_id")
      .eq("tenant_id", tenantId)
      .eq("environment", env)
      .maybeSingle();

    let accountId = existing?.stripe_account_id as string | undefined;

    if (!accountId) {
      const { data: tenant } = await admin
        .from("tenants")
        .select("gym_name, email")
        .eq("id", tenantId)
        .maybeSingle();

      const account = await stripe.accounts.create({
        type: "standard",
        country: "JP",
        email: (tenant?.email as string) || undefined,
        business_profile: { name: (tenant?.gym_name as string) || undefined },
        // 誰の店か Stripe 側からも辿れるようにする（問い合わせ対応で効く）
        metadata: { tenant_id: tenantId },
      });
      accountId = account.id;

      const { error: insErr } = await admin.from("tenant_stripe_accounts").insert({
        tenant_id: tenantId,
        environment: env,
        stripe_account_id: accountId,
      });
      // 行が作れなかったのに Stripe 側だけできると、次回もう1つ作ってしまう。
      if (insErr) {
        console.error("member-connect-onboard: insert failed", insErr.message);
        return json({ error: "Could not record the connected account" }, 500);
      }
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return json({ url: link.url, accountId });
  } catch (e) {
    console.error("member-connect-onboard error:", e);
    return json({ error: (e as Error).message }, 400);
  }
});
