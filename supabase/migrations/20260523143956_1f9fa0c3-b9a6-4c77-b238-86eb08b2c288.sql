
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS gymboard_plan_period TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_trainers INTEGER;

CREATE INDEX IF NOT EXISTS idx_tenants_stripe_subscription_id
  ON public.tenants (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_tenant_member_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_customers INTEGER;
  v_max_trainers INTEGER;
  v_count INTEGER;
BEGIN
  IF NEW.role = 'customer' THEN
    SELECT max_customers INTO v_max_customers FROM public.tenants WHERE id = NEW.tenant_id;
    IF v_max_customers IS NOT NULL THEN
      SELECT COUNT(*) INTO v_count
      FROM public.tenant_members
      WHERE tenant_id = NEW.tenant_id
        AND role = 'customer'
        AND status <> 'cancelled';
      IF v_count >= v_max_customers THEN
        RAISE EXCEPTION '顧客数の上限に達しています。プランをアップグレードしてください'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSIF NEW.role = 'trainer' THEN
    SELECT max_trainers INTO v_max_trainers FROM public.tenants WHERE id = NEW.tenant_id;
    IF v_max_trainers IS NOT NULL THEN
      SELECT COUNT(*) INTO v_count
      FROM public.tenant_members
      WHERE tenant_id = NEW.tenant_id
        AND role = 'trainer'
        AND status <> 'cancelled';
      IF v_count >= v_max_trainers THEN
        RAISE EXCEPTION 'トレーナー数の上限に達しています。プランをアップグレードしてください'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tenant_member_limits ON public.tenant_members;
CREATE TRIGGER trg_enforce_tenant_member_limits
  BEFORE INSERT ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tenant_member_limits();
