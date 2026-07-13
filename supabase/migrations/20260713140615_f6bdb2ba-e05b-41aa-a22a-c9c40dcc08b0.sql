REVOKE UPDATE (booking_date) ON public.bookings FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.enforce_booking_same_day_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_penalty boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN OLD; END IF;
  IF public.has_role(auth.uid(), 'trainer'::public.app_role) THEN RETURN OLD; END IF;
  IF (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
       <> (now() AT TIME ZONE 'Asia/Tokyo')::date THEN RETURN OLD; END IF;
  SELECT t.same_day_cancel_penalty_enabled INTO v_penalty
    FROM public.tenants t WHERE t.id = OLD.tenant_id;
  IF COALESCE(v_penalty, false) THEN
    RAISE EXCEPTION '当日の予約は消化扱いとなるため、この方法では削除できません。アプリの操作をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS enforce_booking_same_day_delete ON public.bookings;
CREATE TRIGGER enforce_booking_same_day_delete
  BEFORE DELETE ON public.bookings FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_same_day_delete();

CREATE OR REPLACE FUNCTION public.enforce_booking_update_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(auth.uid(), 'trainer'::public.app_role) THEN RETURN NEW; END IF;
  IF NEW.status = 'キャンセル済み' AND OLD.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_booking_update_guard ON public.bookings;
CREATE TRIGGER enforce_booking_update_guard
  BEFORE UPDATE ON public.bookings FOR EACH ROW
  EXECUTE FUNCTION public.enforce_booking_update_guard();