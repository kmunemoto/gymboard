CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots(p_tenant_id uuid, from_date date, to_date date)
RETURNS TABLE(booking_date timestamp with time zone, end_booking_date timestamp with time zone, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT tb.booking_date, tb.booking_date + interval '75 minutes' AS end_booking_date, tb.status
  FROM public.trial_bookings tb
  WHERE (tb.tenant_id = p_tenant_id OR tb.tenant_id IS NULL)
    AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT b.booking_date, b.booking_date + interval '75 minutes' AS end_booking_date, b.status
  FROM public.bookings b
  WHERE (b.tenant_id = p_tenant_id OR b.tenant_id IS NULL)
    AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT bs.blocked_date AS booking_date, bs.end_blocked_date AS end_booking_date, 'ブロック済み' AS status
  FROM public.blocked_slots bs
  WHERE (bs.tenant_id = p_tenant_id OR bs.tenant_id IS NULL)
    AND (bs.blocked_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_booked_slots(uuid, date, date) TO anon, authenticated;

DROP POLICY IF EXISTS "Guests can insert trial bookings" ON public.trial_bookings;
DROP POLICY IF EXISTS "Anyone can insert trial bookings" ON public.trial_bookings;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.trial_bookings;
REVOKE INSERT ON public.trial_bookings FROM anon, authenticated;