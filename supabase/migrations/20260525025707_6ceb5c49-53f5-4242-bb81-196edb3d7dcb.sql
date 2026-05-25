
CREATE OR REPLACE FUNCTION public.get_tenant_limit_status(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_customers INTEGER;
  v_max_trainers INTEGER;
  v_customers INTEGER;
  v_trainers INTEGER;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT max_customers, max_trainers
    INTO v_max_customers, v_max_trainers
  FROM public.tenants WHERE id = p_tenant_id;

  SELECT COUNT(*) INTO v_customers FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND role = 'customer' AND status <> 'cancelled';
  SELECT COUNT(*) INTO v_trainers FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND role = 'trainer' AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'customer_count', v_customers,
    'trainer_count', v_trainers,
    'max_customers', v_max_customers,
    'max_trainers', v_max_trainers,
    'customer_over', (v_max_customers IS NOT NULL AND v_customers > v_max_customers),
    'trainer_over',  (v_max_trainers  IS NOT NULL AND v_trainers  > v_max_trainers),
    'over_limit', public.is_tenant_over_limit(p_tenant_id)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_tenant_limit_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_limit_status(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_tenant_over_limit(uuid) FROM anon;
