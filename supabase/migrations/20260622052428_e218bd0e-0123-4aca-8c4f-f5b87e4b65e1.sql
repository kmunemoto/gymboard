-- 1) blocked_slots に source 列を追加
ALTER TABLE public.blocked_slots
  ADD COLUMN IF NOT EXISTS source text;

-- 2) 6月予約ガード: salute_sync 経由のミラーは許可
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

  -- Salute ミラー経路は常に許可（Saluteを正としてGymBoardを一致させるため）
  IF v_source = 'salute_sync' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_target_tenant = v_salute_tenant_id
     AND v_target_date BETWEEN DATE '2026-06-01' AND DATE '2026-06-30' THEN
    RAISE EXCEPTION USING
      MESSAGE = '6月のご予約・キャンセルは、これまで通りSaluteアプリで承ります。7月以降のご予約はこちらのアプリをご利用ください。',
      ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;

-- 3) 重複チェック: salute_sync のミラー挿入は対象外
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
  -- Salute からのミラー予約は Salute 側で既に整合性が取れているのでスキップ
  IF NEW.source = 'salute_sync' THEN
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