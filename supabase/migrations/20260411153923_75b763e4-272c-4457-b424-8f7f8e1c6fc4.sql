DROP FUNCTION IF EXISTS public.get_booked_slots(date);

ALTER TABLE public.blocked_slots
ADD COLUMN IF NOT EXISTS end_blocked_date TIMESTAMPTZ;

WITH normalized AS (
  SELECT
    id,
    created_by,
    reason,
    blocked_date,
    COALESCE(
      CASE
        WHEN reason ~ '^ブロック（[0-9]{2}:[0-9]{2}〜[0-9]{2}:[0-9]{2}）$' THEN
          ((blocked_date AT TIME ZONE 'Asia/Tokyo')::date
            + substring(reason from '〜([0-9]{2}:[0-9]{2})）')::time)
            AT TIME ZONE 'Asia/Tokyo'
      END,
      blocked_date + interval '15 minutes'
    ) AS derived_end
  FROM public.blocked_slots
), grouped AS (
  SELECT DISTINCT ON (created_by, reason, (blocked_date AT TIME ZONE 'Asia/Tokyo')::date)
    id,
    created_by,
    reason,
    blocked_date,
    derived_end
  FROM normalized
  ORDER BY created_by, reason, (blocked_date AT TIME ZONE 'Asia/Tokyo')::date, blocked_date
), to_delete AS (
  DELETE FROM public.blocked_slots bs
  USING grouped g
  WHERE bs.created_by = g.created_by
    AND bs.reason IS NOT DISTINCT FROM g.reason
    AND (bs.blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (g.blocked_date AT TIME ZONE 'Asia/Tokyo')::date
    AND bs.id <> g.id
)
UPDATE public.blocked_slots bs
SET end_blocked_date = g.derived_end
FROM grouped g
WHERE bs.id = g.id;

UPDATE public.blocked_slots
SET end_blocked_date = blocked_date + interval '15 minutes'
WHERE end_blocked_date IS NULL;

ALTER TABLE public.blocked_slots
ALTER COLUMN end_blocked_date SET NOT NULL;

CREATE OR REPLACE FUNCTION public.get_booked_slots(check_date date)
 RETURNS TABLE(booking_date timestamp with time zone, end_booking_date timestamp with time zone, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT tb.booking_date, tb.booking_date + interval '75 minutes' AS end_booking_date, tb.status
  FROM public.trial_bookings tb
  WHERE (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date = check_date
  UNION ALL
  SELECT b.booking_date, b.booking_date + interval '75 minutes' AS end_booking_date, b.status
  FROM public.bookings b
  WHERE (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = check_date
  UNION ALL
  SELECT bs.blocked_date AS booking_date, bs.end_blocked_date AS end_booking_date, 'ブロック済み' AS status
  FROM public.blocked_slots bs
  WHERE (bs.blocked_date AT TIME ZONE 'Asia/Tokyo')::date = check_date;
$function$;

CREATE OR REPLACE FUNCTION public.check_booking_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_start timestamptz;
  new_end timestamptz;
  overlap_count integer;
BEGIN
  new_start := NEW.booking_date;
  new_end := NEW.booking_date + interval '75 minutes';

  SELECT COUNT(*) INTO overlap_count
  FROM (
    SELECT booking_date AS start_at, booking_date + interval '75 minutes' AS end_at
    FROM public.bookings
    WHERE status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
      AND (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT booking_date AS start_at, booking_date + interval '75 minutes' AS end_at
    FROM public.trial_bookings
    WHERE status != 'キャンセル済み'
      AND (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT blocked_date AS start_at, end_blocked_date AS end_at
    FROM public.blocked_slots
    WHERE (blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) AS existing
  WHERE new_start < existing.end_at
    AND existing.start_at < new_end;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  RETURN NEW;
END;
$function$;