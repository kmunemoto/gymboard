-- ②: トライアル期限切れの自動ブロックを追加（安全な条件に限定）。
--
-- 背景:
--   - Stripe管理のトライアルは期限切れで subscription_status が
--     past_due/canceled/unpaid/incomplete_expired になり、既存の
--     is_tenant_subscription_blocked が既にブロックする。
--   - 抜けているのは「Stripeサブスクが無く trial_ends_at だけ設定された
--     有料プランのジムが、トライアル期限を過ぎた」ケース
--     （subscription_status が NULL のまま）。ここだけを追加で塞ぐ。
--
-- 誤ロック防止（前提）:
--   - max_customers IS NULL（無制限＝コンプ/運営。Salute）は対象外
--   - gymboard_plan='free' は対象外
--   - subscription_status が設定済み（active/trialing/past_due/…）は対象外
--     （＝ Stripe管理下のジムはこの新条件では絶対にブロックしない）
--   - 猶予1日（Webサインアップ直後やWebhook遅延での誤発火を避ける）

CREATE OR REPLACE FUNCTION public.is_tenant_subscription_blocked(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_sub_status text;
  v_plan text;
  v_max_customers integer;
  v_trial_ends timestamptz;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT status, subscription_status, gymboard_plan, max_customers, trial_ends_at
    INTO v_status, v_sub_status, v_plan, v_max_customers, v_trial_ends
  FROM public.tenants
  WHERE id = p_tenant_id;

  -- 無制限（コンプ/運営）・無料枠は延滞ブロックの対象外
  IF v_max_customers IS NULL THEN RETURN false; END IF;
  IF v_plan = 'free' THEN RETURN false; END IF;

  -- テナント自体が停止/解約
  IF v_status IN ('suspended', 'cancelled') THEN RETURN true; END IF;

  -- 支払い系の明確な延滞状態
  IF v_sub_status IN ('past_due', 'canceled', 'unpaid', 'incomplete_expired') THEN
    RETURN true;
  END IF;

  -- Stripeサブスク未設定（subscription_status IS NULL）の有料プランで、
  -- トライアル期限を1日以上過ぎている → 未課金の期限切れとみなしブロック。
  IF v_sub_status IS NULL
     AND v_trial_ends IS NOT NULL
     AND v_trial_ends < (now() - interval '1 day') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
