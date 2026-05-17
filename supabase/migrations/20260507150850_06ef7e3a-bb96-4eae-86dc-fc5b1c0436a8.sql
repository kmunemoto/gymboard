CREATE TABLE public.coin_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stripe_session_id text NOT NULL UNIQUE,
  price_id text NOT NULL,
  coins_added integer NOT NULL,
  amount_jpy integer NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coin_purchases_user ON public.coin_purchases(user_id, created_at DESC);
ALTER TABLE public.coin_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own coin purchases" ON public.coin_purchases FOR SELECT TO authenticated USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Service role manages coin purchases" ON public.coin_purchases FOR ALL TO public USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');