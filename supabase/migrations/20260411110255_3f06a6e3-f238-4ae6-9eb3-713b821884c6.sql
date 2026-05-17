
-- 1. Create secure function to get trainer user_ids (replaces direct table query)
CREATE OR REPLACE FUNCTION public.get_trainer_ids()
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'trainer';
$$;

-- 2. Drop the broad SELECT policy that exposes trainer UUIDs to all authenticated users
DROP POLICY IF EXISTS "Authenticated users can view trainer roles" ON public.user_roles;

-- 3. Rate-limit trial_bookings: max 3 per guest_contact in 24 hours
CREATE OR REPLACE FUNCTION public.check_trial_booking_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT COUNT(*) INTO recent_count
  FROM public.trial_bookings
  WHERE guest_contact = NEW.guest_contact
    AND created_at > now() - interval '24 hours';

  IF recent_count >= 3 THEN
    RAISE EXCEPTION '短時間に多くの予約がされています。しばらくお待ちください。';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER check_trial_rate_limit
BEFORE INSERT ON public.trial_bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_trial_booking_rate_limit();
