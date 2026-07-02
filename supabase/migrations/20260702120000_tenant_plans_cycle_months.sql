-- サブスク（月N回など）の利用期間（サイクル月数）をジム／プランごとに設定可能にする。
-- 既定は null（＝1ヶ月）で、既存プラン・既存会員の挙動は一切変わらない。
-- 応当日ベース: 起算日 + cycle_months ヶ月 でサイクルが切り替わる。
-- ticket / period プランは従来どおり validity_days を使うため、この列は無関係。

ALTER TABLE public.tenant_plans
  ADD COLUMN IF NOT EXISTS cycle_months integer;

COMMENT ON COLUMN public.tenant_plans.cycle_months IS
  'サブスクの利用期間（月数、応当日ベース）。null/未設定は1ヶ月。ticket/period では未使用。';
