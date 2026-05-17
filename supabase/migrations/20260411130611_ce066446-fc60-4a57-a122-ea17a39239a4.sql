
-- Create blocked_slots table
CREATE TABLE public.blocked_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  blocked_date timestamp with time zone NOT NULL,
  reason text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trainers can view blocked slots" ON public.blocked_slots
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers can insert blocked slots" ON public.blocked_slots
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers can delete blocked slots" ON public.blocked_slots
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'trainer'::app_role));

-- Customers need to see blocked slots to know which times are unavailable
CREATE POLICY "Customers can view blocked slots" ON public.blocked_slots
  FOR SELECT TO authenticated
  USING (true);

-- Update get_booked_slots to include blocked slots
CREATE OR REPLACE FUNCTION public.get_booked_slots(check_date date)
 RETURNS TABLE(booking_date timestamp with time zone, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tb.booking_date, tb.status
  FROM public.trial_bookings tb
  WHERE tb.booking_date::date = check_date
  UNION ALL
  SELECT b.booking_date, b.status
  FROM public.bookings b
  WHERE b.booking_date::date = check_date
  UNION ALL
  SELECT bs.blocked_date AS booking_date, 'ブロック済み' AS status
  FROM public.blocked_slots bs
  WHERE bs.blocked_date::date = check_date;
$function$;

-- Update check_booking_overlap to also check blocked slots
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
    SELECT booking_date FROM public.bookings
    WHERE (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
      AND status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
    UNION ALL
    SELECT booking_date FROM public.trial_bookings
    WHERE (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
      AND status != 'キャンセル済み'
    UNION ALL
    SELECT blocked_date AS booking_date FROM public.blocked_slots
    WHERE (blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) AS existing
  WHERE ABS(new_start - (EXTRACT(HOUR FROM existing.booking_date AT TIME ZONE 'Asia/Tokyo') * 60
                        + EXTRACT(MINUTE FROM existing.booking_date AT TIME ZONE 'Asia/Tokyo'))) < 75;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  RETURN NEW;
END;
$function$;
