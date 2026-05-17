CREATE OR REPLACE FUNCTION public.check_booking_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_start integer;
  overlap_count integer;
BEGIN
  new_start := EXTRACT(HOUR FROM NEW.booking_date AT TIME ZONE 'Asia/Tokyo') * 60
              + EXTRACT(MINUTE FROM NEW.booking_date AT TIME ZONE 'Asia/Tokyo');

  SELECT COUNT(*) INTO overlap_count
  FROM (
    -- Regular bookings occupy 75 min (60 session + 15 buffer)
    SELECT booking_date, 75 AS duration FROM public.bookings
    WHERE (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
      AND status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
    UNION ALL
    -- Trial bookings occupy 75 min
    SELECT booking_date, 75 AS duration FROM public.trial_bookings
    WHERE (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
      AND status != 'キャンセル済み'
    UNION ALL
    -- Blocked slots are 15-min records
    SELECT blocked_date AS booking_date, 15 AS duration FROM public.blocked_slots
    WHERE (blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) AS existing
  WHERE new_start < (EXTRACT(HOUR FROM existing.booking_date AT TIME ZONE 'Asia/Tokyo') * 60
                    + EXTRACT(MINUTE FROM existing.booking_date AT TIME ZONE 'Asia/Tokyo')) + existing.duration
    AND (EXTRACT(HOUR FROM existing.booking_date AT TIME ZONE 'Asia/Tokyo') * 60
        + EXTRACT(MINUTE FROM existing.booking_date AT TIME ZONE 'Asia/Tokyo')) < new_start + 75;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  RETURN NEW;
END;
$function$;