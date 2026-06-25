-- B: ジム側サブスクの条件未達時にアプリ利用を制限する（サーバー側強制）。
--
-- 背景: これまで席数上限（is_tenant_over_limit）のみがトリガーで強制されており、
--   支払い失敗(past_due)・解約(canceled)・テナント停止(status)では何の制限も
--   掛からず、延滞ジムが上限内で全機能を使い続けられた。
--
-- 方針: 明確な延滞状態のみをブロックし、誤ロックを避ける。
--   - max_customers IS NULL（無制限＝コンプ/プラットフォーム運営。例: Salute御所南）は対象外
--   - gymboard_plan='free'（無料枠は有効。席数のみで制限）は対象外
--   - tenants.status が suspended/cancelled はブロック
--   - subscription_status が past_due/canceled/unpaid/incomplete_expired はブロック
--   既存の enforce_tenant_plan_limit トリガー（bookings/workouts/meals 等）に相乗りさせ、
--   延滞中は新規の予約・記録作成をサーバー側で拒否する。

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
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT status, subscription_status, gymboard_plan, max_customers
    INTO v_status, v_sub_status, v_plan, v_max_customers
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

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_tenant_subscription_blocked(uuid) TO authenticated, anon;

-- 既存トリガー関数に延滞チェックを追加（席数上限＋サブスク延滞の両方を強制）
CREATE OR REPLACE FUNCTION public.enforce_tenant_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    IF public.is_tenant_over_limit(NEW.tenant_id) THEN
      RAISE EXCEPTION 'プランの上限を超えているため、この操作はできません。プランをアップグレードするか、顧客数を上限以下にしてください。'
        USING ERRCODE = 'check_violation';
    END IF;
    IF public.is_tenant_subscription_blocked(NEW.tenant_id) THEN
      RAISE EXCEPTION 'サブスクリプションが有効ではありません。お支払い状況をご確認のうえ、プランを有効化してください。'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
