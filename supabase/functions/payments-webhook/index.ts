import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, verifyWebhook } from "../_shared/stripe.ts";

const COIN_MAP: Record<string, number> = {
  coin_starter_jpy_300: 200,
  coin_value_jpy_800: 800,
  coin_premium_jpy_1800: 2000,
};
const AMOUNT_MAP: Record<string, number> = {
  coin_starter_jpy_300: 300,
  coin_value_jpy_800: 800,
  coin_premium_jpy_1800: 1800,
};

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
  }
  return _supabase;
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  const userId = session.metadata?.userId;
  const priceId = session.metadata?.priceId;
  if (!userId || !priceId) {
    console.error("Missing metadata in session", session.id);
    return;
  }
  const coins = COIN_MAP[priceId];
  const amount = AMOUNT_MAP[priceId];
  if (!coins) {
    console.error("Unknown priceId", priceId);
    return;
  }

  const supabase = getSupabase();

  // Idempotency: insert purchase record (UNIQUE on stripe_session_id)
  const { error: insertErr } = await supabase.from("coin_purchases").insert({
    user_id: userId,
    stripe_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    price_id: priceId,
    coins_added: coins,
    amount_jpy: amount,
    environment: env,
  });
  if (insertErr) {
    if (insertErr.code === "23505") {
      console.log("Already processed session", session.id);
      return;
    }
    throw insertErr;
  }

  // Add coins to user_avatars (upsert)
  const { data: avatar } = await supabase
    .from("user_avatars")
    .select("coins")
    .eq("user_id", userId)
    .maybeSingle();

  const currentCoins = (avatar?.coins as number) || 0;
  if (avatar) {
    await supabase.from("user_avatars").update({ coins: currentCoins + coins }).eq("user_id", userId);
  } else {
    await supabase.from("user_avatars").insert({ user_id: userId, coins, total_exp: 0, level: 1 });
  }
}

async function handleChargeRefunded(charge: any, env: StripeEnv) {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!paymentIntentId) {
    console.error("charge.refunded missing payment_intent", charge.id);
    return;
  }
  const supabase = getSupabase();

  // Find the original purchase
  const { data: original } = await supabase
    .from("coin_purchases")
    .select("id,user_id,price_id,coins_added,amount_jpy,stripe_session_id,environment")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .eq("is_refund", false)
    .maybeSingle();

  if (!original) {
    console.error("No original purchase for payment_intent", paymentIntentId);
    return;
  }

  // Compute refunded coins proportional to refund amount
  const amountRefunded = Number(charge.amount_refunded || 0);
  const amountTotal = Number(charge.amount || original.amount_jpy);
  if (amountRefunded <= 0 || amountTotal <= 0) return;

  const ratio = Math.min(1, amountRefunded / amountTotal);
  const coinsToRefund = Math.floor(Number(original.coins_added) * ratio);
  if (coinsToRefund <= 0) return;

  // Idempotent refund record (one row per refund event id)
  const refundId: string = charge.id ? `refund_${charge.id}` : `refund_${paymentIntentId}`;
  const { error: insertErr } = await supabase.from("coin_purchases").insert({
    user_id: original.user_id,
    stripe_session_id: refundId,
    stripe_payment_intent_id: paymentIntentId,
    price_id: original.price_id,
    coins_added: -coinsToRefund,
    amount_jpy: -amountRefunded,
    environment: env,
    is_refund: true,
    refund_of_session_id: original.stripe_session_id,
  });
  if (insertErr) {
    if (insertErr.code === "23505") {
      console.log("Refund already processed", refundId);
      return;
    }
    throw insertErr;
  }

  // Deduct coins from user_avatars (clamp at 0)
  const { data: avatar } = await supabase
    .from("user_avatars")
    .select("coins")
    .eq("user_id", original.user_id)
    .maybeSingle();
  const current = (avatar?.coins as number) || 0;
  const next = Math.max(0, current - coinsToRefund);
  if (avatar) {
    await supabase.from("user_avatars").update({ coins: next }).eq("user_id", original.user_id);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawEnv = new URL(req.url).searchParams.get("env");
  if (rawEnv !== "sandbox" && rawEnv !== "live") {
    return new Response(JSON.stringify({ received: true, ignored: "invalid env" }), { status: 200 });
  }
  const env: StripeEnv = rawEnv;
  try {
    const event = await verifyWebhook(req, env);
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object, env);
    } else if (event.type === "charge.refunded") {
      await handleChargeRefunded(event.data.object, env);
    } else {
      console.log("Unhandled event:", event.type);
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Webhook error:", e);
    return new Response("Webhook error", { status: 400 });
  }
});