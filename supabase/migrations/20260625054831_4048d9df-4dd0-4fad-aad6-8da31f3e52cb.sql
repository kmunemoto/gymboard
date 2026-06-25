CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.propagate_trial_cancellation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE v_bd timestamptz; v_gn text; v_tenant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_bd := OLD.booking_date; v_gn := OLD.guest_name; v_tenant := OLD.tenant_id;
  ELSE
    IF NEW.status IS DISTINCT FROM 'キャンセル済み' OR OLD.status = 'キャンセル済み' THEN RETURN NEW; END IF;
    v_bd := NEW.booking_date; v_gn := NEW.guest_name; v_tenant := NEW.tenant_id;
  END IF;
  IF v_tenant <> 'ceda19b0-d5e0-4928-ab2e-996a0b823af4' THEN RETURN COALESCE(NEW, OLD); END IF;
  PERFORM net.http_post(
    url := 'https://rrbfwitprzuevzytykrq.supabase.co/functions/v1/sync-trial-cancel-to-salute',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('booking_date', v_bd, 'guest_name', v_gn)
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'propagate_trial_cancellation failed: %', SQLERRM; RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trial_cancellation_to_salute ON public.trial_bookings;
CREATE TRIGGER trial_cancellation_to_salute
  AFTER DELETE OR UPDATE ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.propagate_trial_cancellation();