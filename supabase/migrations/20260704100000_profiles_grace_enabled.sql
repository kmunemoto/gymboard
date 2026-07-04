-- お客様ごとの「猶予（大目に見る）」ON/OFF。
-- プランの猶予日数（tenant_plans.grace_days）を適用するかを顧客単位で切り替える。
-- null/true = 適用する（既定）、false = このお客様は期限どおり厳格に扱う。
-- 既存データは null のままなので挙動は一切変わらない。

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS grace_enabled boolean;

COMMENT ON COLUMN public.profiles.grace_enabled IS
  'プランの猶予日数（grace_days）をこのお客様に適用するか。null/true=適用（既定）、false=適用しない（期限どおり）。';
