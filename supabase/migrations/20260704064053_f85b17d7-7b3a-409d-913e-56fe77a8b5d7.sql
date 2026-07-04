CREATE OR REPLACE FUNCTION public.guard_salute_june_2026_bookings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_salute_tenant_id constant uuid := 'ceda19b0-d5e0-4928-ab2e-996a0b823af4';
  v_target_tenant uuid;
  v_target_date date;
  v_source text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_target_tenant := OLD.tenant_id;
    v_target_date := (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date;
    v_source := OLD.source;
  ELSE
    v_target_tenant := NEW.tenant_id;
    v_target_date := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date;
    v_source := NEW.source;
  END IF;

  IF v_source = 'salute_sync' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF public.has_role(auth.uid(), 'trainer'::public.app_role) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_target_tenant = v_salute_tenant_id
     AND v_target_date BETWEEN DATE '2026-06-01' AND DATE '2026-06-30' THEN
    RAISE EXCEPTION USING
      MESSAGE = '6月のご予約・キャンセルは、これまで通りSaluteアプリで承ります。7月以降のご予約はこちらのアプリをご利用ください。',
      ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;