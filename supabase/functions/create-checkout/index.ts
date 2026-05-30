import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";
import { verifyCaller } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    // Verify caller is an authenticated user. The userId is always derived
    // from the JWT — never trusted from the request body — so a payment can
    // never be credited to an account the caller doesn't own.
    const caller = await verifyCaller(req);
    if (!caller?.userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = caller.userId;

    const { priceId, customerEmail, returnUrl, environment } = await req.json();
    if (!priceId || !/^[a-zA-Z0-9_-]+$/.test(priceId)) throw new Error('Invalid priceId');
    if (environment !== 'sandbox' && environment !== 'live') throw new Error('Invalid environment');
    if (!returnUrl) throw new Error('Missing returnUrl');

    const env: StripeEnv = environment;
    const stripe = createStripeClient(env);

    const prices = await stripe.prices.list({ lookup_keys: [priceId] });
    if (!prices.data.length) throw new Error('Price not found');
    const stripePrice = prices.data[0];

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: stripePrice.id, quantity: 1 }],
      mode: 'payment',
      ui_mode: 'embedded_page',
      return_url: returnUrl,
      ...(customerEmail && { customer_email: customerEmail }),
      metadata: { userId, priceId },
    });

    return new Response(JSON.stringify({ clientSecret: session.client_secret }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (e) {
    console.error('create-checkout error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
