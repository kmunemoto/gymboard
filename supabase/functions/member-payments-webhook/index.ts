// お客様の支払い結果を受け取る（Stripe Connect の webhook）。
//
// ⚠️ **Connect の webhook は「接続先アカウントで起きたイベント」として届く。**
//    プラットフォームの webhook とはエンドポイントを分ける。
//
// ⚠️ **同じイベントは何度も届く**（Stripe の仕様。再送もある）。
//    `member_payments.stripe_session_id` の UNIQUE 制約で2回目以降を DB 側で弾く。
//    「あるか見てから入れる」は競合するので当てにしない。
//
// ⚠️ **署名の検証を通らないものは何も書かない。** ここを緩めると、
//    誰でも「払った」を作れる（＝回数券をタダで手に入れられる）。

import { verifyWebhook, type StripeEnv } from "../_shared/stripe.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  const environment = url.searchParams.get("environment");
  if (environment !== "sandbox" && environment !== "live") {
    return new Response("Invalid environment", { status: 400 });
  }
  const env: StripeEnv = environment;

  let event: { type: string; data: { object: Record<string, unknown> }; account?: string };
  try {
    event = (await verifyWebhook(req, env)) as typeof event;
  } catch (e) {
    // 署名が合わないものは 400。ここで 200 を返すと Stripe が再送しなくなる。
    console.error("member-payments-webhook: signature check failed:", (e as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Record<string, any>;
      const md = (s.metadata ?? {}) as Record<string, string>;
      // metadata が無いものは自分が作ったセッションではない（他の用途の課金）。
      // ⚠️ 推測で書かない。誰の分か分からない支払いを勝手に誰かに紐づけない。
      if (!md.user_id || !md.tenant_id || !md.plan_name) {
        console.warn("member-payments-webhook: session without our metadata, ignoring", s.id);
        return new Response(JSON.stringify({ received: true }), { status: 200 });
      }

      const { error } = await admin.from("member_payments").insert({
        tenant_id: md.tenant_id,
        user_id: md.user_id,
        plan_id: md.plan_id || null,
        plan_name: md.plan_name,
        environment: env,
        stripe_account_id: event.account ?? "",
        stripe_session_id: s.id,
        stripe_payment_intent_id: s.payment_intent ?? null,
        amount: Number(s.amount_total ?? 0),
        currency: String(s.currency ?? "jpy"),
        status: s.payment_status === "paid" ? "paid" : "pending",
        paid_at: s.payment_status === "paid" ? new Date().toISOString() : null,
      });

      // 23505 = unique_violation。再送なので成功として返す（でないと Stripe が送り続ける）。
      if (error && (error as { code?: string }).code !== "23505") {
        console.error("member-payments-webhook: insert failed", error.message);
        return new Response("Insert failed", { status: 500 });
      }

      // ⚠️ **回数の付与はここではやらない。** 残回数は既存の
      //    tenant_member_plans / bookings が持っており、computePlanUsage が数える。
      //    ここで別に数え始めると、2つの真実ができて必ずズレる。
      //    支払い記録を見て店が付与する（第2段で自動化する）。
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    if (event.type === "account.updated") {
      const a = event.data.object as Record<string, any>;
      await admin
        .from("tenant_stripe_accounts")
        .update({
          charges_enabled: !!a.charges_enabled,
          payouts_enabled: !!a.payouts_enabled,
          details_submitted: !!a.details_submitted,
          country: a.country ?? null,
          default_currency: a.default_currency ?? null,
          requirements: a.requirements ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_account_id", a.id);

      // 画面の出し分け用のヒントを焼き込む（認可の根拠ではない。実ゲートは checkout 側）
      const { data: row } = await admin
        .from("tenant_stripe_accounts")
        .select("tenant_id")
        .eq("stripe_account_id", a.id)
        .maybeSingle();
      if (row?.tenant_id) {
        await admin
          .from("tenants")
          .update({ stripe_charges_enabled: !!a.charges_enabled })
          .eq("id", row.tenant_id);
      }
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ received: true, ignored: event.type }), { status: 200 });
  } catch (e) {
    console.error("member-payments-webhook error:", e);
    return new Response("Error", { status: 500 });
  }
});
