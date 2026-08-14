-- お客様がアプリ内で月謝・回数券を払えるようにする（第1段: 回数券の単発購入）
--
-- ## 誰の売上か、から設計する
--
-- お客様の月謝・回数券は**ジムボードの売上ではなく、各ジムの売上**。
-- プラットフォーム口座で受けて後から分配する形にすると「他人の代金を事業として預かる」
-- 形が残り、資金決済法（資金移動業／第三者型前払式支払手段）の論点が発生する。
--
-- そこで **Stripe Connect Standard + Direct charges**（`Stripe-Account` ヘッダで
-- 接続先アカウント上に課金を作る）にする。資金が一度もプラットフォームを通らないので、
--   ・売主 …… 各ジム
--   ・返金の責任 …… 各ジム
--   ・特商法の表示義務 …… 各ジム
--   ・前払式支払手段（回数券）の発行者 …… 各ジム
-- が自然にそろい、上の論点がそもそも起きない。
--
-- ## ⚠️ 既存の死んだ足場を流用しない
--
-- `supabase/functions/create-checkout`（＋ `payments-webhook`）は
-- **src/ に呼び出し元が0件**で、テナントの概念も無く**プラットフォーム口座に課金する**。
-- これを配線すると**お客様のお金がジムではなくジムボードに入る**。使わないこと。
--
-- ⚠️ `tenants.stripe_customer_id` / `stripe_subscription_id` は
-- **店がジムボードへ払う SaaS 契約**のもの。絶対に流用しない。

-- ============================================================
-- 0. tenants（全て「無ければ決済を出さない」に倒す）
-- ============================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS payments_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_terms_url text;

COMMENT ON COLUMN public.tenants.payments_enabled IS
  'この店がアプリ内決済を受け付けるか。オーナーが明示的にONにするまで false（既定）＝この機能を入れる前と完全に同じ挙動。';
COMMENT ON COLUMN public.tenants.stripe_charges_enabled IS
  'Stripe 側の実際の受け取り可否。account.updated を webhook が焼き込む。⚠️ **画面の出し分け用のヒントであって認可の根拠ではない**（オーナーは既存の tenants UPDATE ポリシーでこの値を偽装できる）。実ゲートは Edge Function が Stripe に直接問い合わせて行う。';
COMMENT ON COLUMN public.tenants.payment_terms_url IS
  '各店の特定商取引法に基づく表記・返金/キャンセル規定のURL。売主は店なので店ごとに要る。空のうちは購入ボタンを出さない。';

-- ============================================================
-- 1. 店の Stripe アカウント（テナント × 環境で1行）
-- ============================================================
-- ⚠️ environment を UNIQUE キーに含めるのが要点。`tenants.stripe_customer_id` は
--    環境を分けていないため gymboard-create-checkout に
--    「Stale stripe_customer_id, will recreate」の後付け回避コードがある。同じ轍を踏まない。
CREATE TABLE IF NOT EXISTS public.tenant_stripe_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  environment       text NOT NULL CHECK (environment IN ('sandbox','live')),
  stripe_account_id text NOT NULL,
  charges_enabled   boolean NOT NULL DEFAULT false,
  payouts_enabled   boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  country           text,
  default_currency  text,
  requirements      jsonb,
  connected_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_stripe_accounts
  ON public.tenant_stripe_accounts (tenant_id, environment);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_stripe_account_id
  ON public.tenant_stripe_accounts (stripe_account_id);

ALTER TABLE public.tenant_stripe_accounts ENABLE ROW LEVEL SECURITY;

-- 読めるのはその店のスタッフだけ。**書き込みポリシーは作らない**（service_role のみ）。
DROP POLICY IF EXISTS "Tenant staff view stripe account" ON public.tenant_stripe_accounts;
CREATE POLICY "Tenant staff view stripe account" ON public.tenant_stripe_accounts
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

COMMENT ON TABLE public.tenant_stripe_accounts IS
  '各ジムの Stripe Connect アカウント。Direct charges の宛先。書き込みは Edge Function（service_role）のみ。';

-- ============================================================
-- 2. 決済の台帳
-- ============================================================
-- ⚠️ **金額の真実は Stripe 側にある。** ここは「何を売って、どうなったか」の記録で、
--    残回数の計算には使わない（回数は既存の tenant_member_plans / bookings が持つ）。
CREATE TABLE IF NOT EXISTS public.member_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL,
  -- 何を買ったか。tenant_plans を指すが、プランが消えても記録は残す（RESTRICT しない）。
  plan_id             uuid,
  plan_name           text NOT NULL,
  environment         text NOT NULL CHECK (environment IN ('sandbox','live')),
  stripe_account_id   text NOT NULL,
  -- Checkout Session と PaymentIntent。**冪等性の要**（webhook は何度でも来る）。
  stripe_session_id   text NOT NULL,
  stripe_payment_intent_id text,
  amount              integer NOT NULL CHECK (amount >= 0),
  currency            text NOT NULL DEFAULT 'jpy',
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','failed','refunded')),
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ webhook は同じイベントを何度も送る（Stripe の仕様）。session_id で一意にして、
--    2回目以降を DB 側で弾く。アプリ側の「あるか見てから入れる」は競合する。
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_payments_session
  ON public.member_payments (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_member_payments_user
  ON public.member_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_member_payments_tenant
  ON public.member_payments (tenant_id, created_at DESC);

ALTER TABLE public.member_payments ENABLE ROW LEVEL SECURITY;

-- 本人と、その店のスタッフが読める。**書き込みポリシーは作らない**（service_role のみ）。
-- 画面から直接書けると「払ったことにする」ができてしまう。
DROP POLICY IF EXISTS "View own payments" ON public.member_payments;
CREATE POLICY "View own payments" ON public.member_payments
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer'])
  );

COMMENT ON TABLE public.member_payments IS
  'お客様の支払い記録（回数券・月謝）。書き込みは Edge Function（service_role）のみ。金額の真実は Stripe 側にあり、ここは記録。残回数の計算には使わない。';

-- ============================================================
-- 3. 販売する商品（プランに価格を紐づける）
-- ============================================================
-- ⚠️ Stripe の Price は**接続先アカウントごとに別物**なので、環境とアカウントで持つ。
CREATE TABLE IF NOT EXISTS public.tenant_plan_prices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id           uuid NOT NULL REFERENCES public.tenant_plans(id) ON DELETE CASCADE,
  environment       text NOT NULL CHECK (environment IN ('sandbox','live')),
  stripe_price_id   text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_plan_prices
  ON public.tenant_plan_prices (plan_id, environment);

ALTER TABLE public.tenant_plan_prices ENABLE ROW LEVEL SECURITY;

-- お客様も「買えるプラン」を見る必要があるので、同じ店の人は読める。
DROP POLICY IF EXISTS "Tenant members view plan prices" ON public.tenant_plan_prices;
CREATE POLICY "Tenant members view plan prices" ON public.tenant_plan_prices
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

COMMENT ON TABLE public.tenant_plan_prices IS
  'tenant_plans と Stripe Price の対応。Price は接続先アカウントごとに別物なので environment を含めて一意にする。書き込みは Edge Function（service_role）のみ。';
