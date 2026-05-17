ALTER TABLE public.coin_purchases
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS is_refund boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refund_of_session_id text;

CREATE INDEX IF NOT EXISTS idx_coin_purchases_payment_intent
  ON public.coin_purchases(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;