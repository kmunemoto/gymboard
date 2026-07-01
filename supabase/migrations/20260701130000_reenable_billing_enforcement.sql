-- 課金システムを復活させる（20260701120000_disable_billing_enforcement.sql の差し戻し）。
--
-- 背景:
--   一旦無料・無制限にするため enforce_tenant_plan_limit トリガーを素通り(RETURN NEW)に
--   していたが、サブスク化のタイミングで元の強制ロジックに戻す。
--   判定関数 is_tenant_over_limit / is_tenant_subscription_blocked は無効化中も
--   削除していなかったため、そのまま再度呼び出すだけでよい。

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
