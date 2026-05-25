
-- Part 1: over-limit checker
CREATE OR REPLACE FUNCTION public.is_tenant_over_limit(p_tenant_id uuid)
RETURNS boolean
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
    RETURN false;
  END IF;

  SELECT max_customers, max_trainers
    INTO v_max_customers, v_max_trainers
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF v_max_customers IS NOT NULL THEN
    SELECT COUNT(*) INTO v_customers
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND role = 'customer'
      AND status <> 'cancelled';
    IF v_customers > v_max_customers THEN
      RETURN true;
    END IF;
  END IF;

  IF v_max_trainers IS NOT NULL THEN
    SELECT COUNT(*) INTO v_trainers
    FROM public.tenant_members
    WHERE tenant_id = p_tenant_id
      AND role = 'trainer'
      AND status <> 'cancelled';
    IF v_trainers > v_max_trainers THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_tenant_over_limit(uuid) TO authenticated, anon;

-- Part 2: block new operational writes when over limit
CREATE OR REPLACE FUNCTION public.enforce_tenant_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND public.is_tenant_over_limit(NEW.tenant_id) THEN
    RAISE EXCEPTION 'プランの上限を超えているため、この操作はできません。プランをアップグレードするか、顧客数を上限以下にしてください。'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_plan_limit_bookings ON public.bookings;
CREATE TRIGGER trg_enforce_plan_limit_bookings
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_plan_limit();

DROP TRIGGER IF EXISTS trg_enforce_plan_limit_workouts ON public.workouts;
CREATE TRIGGER trg_enforce_plan_limit_workouts
  BEFORE INSERT ON public.workouts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_plan_limit();

DROP TRIGGER IF EXISTS trg_enforce_plan_limit_meals ON public.meals;
CREATE TRIGGER trg_enforce_plan_limit_meals
  BEFORE INSERT ON public.meals
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_plan_limit();

DROP TRIGGER IF EXISTS trg_enforce_plan_limit_measurements ON public.user_measurements;
CREATE TRIGGER trg_enforce_plan_limit_measurements
  BEFORE INSERT ON public.user_measurements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_plan_limit();

DROP TRIGGER IF EXISTS trg_enforce_plan_limit_progress_photos ON public.progress_photos;
CREATE TRIGGER trg_enforce_plan_limit_progress_photos
  BEFORE INSERT ON public.progress_photos
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_plan_limit();
