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
  -- source 列が無いテーブル(trial_bookings)でもエラーにならないよう to_jsonb 経由で参照
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  new_start := NEW.booking_date;
  new_end := NEW.booking_date + interval '75 minutes';

  SELECT COUNT(*) INTO overlap_count
  FROM (
    SELECT booking_date AS start_at, booking_date + interval '75 minutes' AS end_at
    FROM public.bookings
    WHERE status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
      AND tenant_id = NEW.tenant_id
      AND (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT booking_date AS start_at, booking_date + interval '75 minutes' AS end_at
    FROM public.trial_bookings
    WHERE status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
      AND tenant_id = NEW.tenant_id
      AND (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT blocked_date AS start_at, end_blocked_date AS end_at
    FROM public.blocked_slots
    WHERE tenant_id = NEW.tenant_id
      AND (blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) AS existing
  WHERE new_start < existing.end_at
    AND existing.start_at < new_end;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  RETURN NEW;
END;
$function$;