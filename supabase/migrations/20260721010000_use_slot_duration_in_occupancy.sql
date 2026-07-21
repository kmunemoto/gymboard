-- tenants.slot_duration_minutes（「1セッションの長さ」設定）を、これまで固定60分だった
-- 予約の占有時間計算（重複判定・埋まり枠取得）にも反映させる。
-- 既存テナントの slot_duration_minutes は全て 60（既定値）のため、このマイグレーション単体
-- では挙動は一切変わらない。60以外に設定して初めて占有時間が変わる。

-- 重複防止トリガー: 占有時間を「テナントのslot_duration_minutes(既定60)+booking_buffer_minutes」
-- で計算するよう変更（従来は 60 固定 + バッファ）。
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
  buffer_min integer;
  session_min integer;
  footprint interval;
BEGIN
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes INTO buffer_min, session_min
  FROM public.tenants t WHERE t.id = NEW.tenant_id;
  footprint := make_interval(mins => COALESCE(session_min, 60) + COALESCE(buffer_min, 15));

  new_start := NEW.booking_date;
  new_end := NEW.booking_date + footprint;

  SELECT COUNT(*) INTO overlap_count
  FROM (
    SELECT booking_date AS start_at, booking_date + footprint AS end_at
    FROM public.bookings
    WHERE status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
      AND tenant_id = NEW.tenant_id
      AND (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT booking_date AS start_at, booking_date + footprint AS end_at
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

-- 埋まり枠取得RPC: end_booking_date の計算に slot_duration_minutes も反映。
CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots(p_tenant_id uuid, from_date date, to_date date)
RETURNS TABLE(booking_date timestamp with time zone, end_booking_date timestamp with time zone, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  buffer_min integer;
  session_min integer;
  footprint interval;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes INTO buffer_min, session_min
  FROM public.tenants t WHERE t.id = p_tenant_id;
  footprint := make_interval(mins => COALESCE(session_min, 60) + COALESCE(buffer_min, 15));

  RETURN QUERY
  SELECT tb.booking_date, tb.booking_date + footprint AS end_booking_date, tb.status
  FROM public.trial_bookings tb
  WHERE (tb.tenant_id = p_tenant_id OR tb.tenant_id IS NULL)
    AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT b.booking_date, b.booking_date + footprint AS end_booking_date, b.status
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

-- 公開テナント情報RPC: 体験予約ページが候補枠自身の占有時間を正しく計算できるよう
-- slot_duration_minutes を追加で返す（booking_buffer_minutes は前回のマイグレーションで追加済み）。
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);
CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
RETURNS TABLE (
  id uuid, gym_name text, gym_name_short text, address text,
  logo_url text, primary_color text, trial_info_title text, trial_info_body text,
  booking_buffer_minutes integer, slot_duration_minutes integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated;
