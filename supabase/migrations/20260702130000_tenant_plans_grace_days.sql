-- サブスク（月N回など）の「猶予日数」をジム／プランごとに設定可能にする。
-- 期限（サイクル末）を過ぎても、前サイクルが未消化なら graceDays 日までは
-- 前サイクル分（大目に見た消化）として扱い、新サイクルの1回目にしない。
-- 既定は null（＝0＝猶予なし）で、既存プラン・既存会員の挙動は一切変わらない。
-- ticket / period プランでは未使用。

ALTER TABLE public.tenant_plans
  ADD COLUMN IF NOT EXISTS grace_days integer;

COMMENT ON COLUMN public.tenant_plans.grace_days IS
  'サブスクの猶予日数。期限超過後この日数までの予約は前サイクル未消化ぶんとして繰り入れる。null/未設定は0（猶予なし）。ticket/period では未使用。';
