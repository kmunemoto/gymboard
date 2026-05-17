
CREATE OR REPLACE FUNCTION public.check_booking_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_start integer;
  overlap_count integer;
BEGIN
  new_start := EXTRACT(HOUR FROM NEW.booking_date AT TIME ZONE 'Asia/Tokyo') * 60
              + EXTRACT(MINUTE FROM NEW.booking_date AT TIME ZONE 'Asia/Tokyo');

  SELECT COUNT(*) INTO overlap_count
  FROM (
    SELECT booking_date FROM public.bookings
    WHERE (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
      AND status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
    UNION ALL
    SELECT booking_date FROM public.trial_bookings
    WHERE (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
      AND status != 'キャンセル済み'
  ) AS existing
  WHERE ABS(new_start - (EXTRACT(HOUR FROM existing.booking_date AT TIME ZONE 'Asia/Tokyo') * 60
                        + EXTRACT(MINUTE FROM existing.booking_date AT TIME ZONE 'Asia/Tokyo'))) < 75;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_booking_overlap
BEFORE INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_booking_overlap();

CREATE TRIGGER prevent_trial_booking_overlap
BEFORE INSERT ON public.trial_bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_booking_overlap();
