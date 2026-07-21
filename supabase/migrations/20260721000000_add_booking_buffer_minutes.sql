-- 予約と予約の間に必ず空ける時間（分）をジムごとに設定できるようにする。
-- 既定15分＝これまでの決め打ち(60分セッション+15分バッファ=75分)と完全互換。
-- 既存テナントは全て既定値になるため、このマイグレーション自体で挙動は一切変わらない。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_buffer_minutes INTEGER NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.tenants.booking_buffer_minutes IS
  '予約と予約の間に必ず空ける時間（分）。既定15分。セッション60分(固定)+この間隔が、予約1件が
   占有する時間として重複判定（check_booking_overlap トリガー・get_tenant_booked_slots）に使われる。';

-- 重複防止トリガー: 占有時間を「60分+テナントのbooking_buffer_minutes」で計算するよう変更。
-- tenant_id が無い/見つからない行は既定15分（=75分フットプリント、旧来と同一）にフォールバック。
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
  footprint interval;
BEGIN
  -- source 列が無いテーブル(trial_bookings)でもエラーにならないよう to_jsonb 経由で参照
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  SELECT t.booking_buffer_minutes INTO buffer_min
  FROM public.tenants t WHERE t.id = NEW.tenant_id;
  footprint := make_interval(mins => 60 + COALESCE(buffer_min, 15));

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

-- 埋まり枠取得RPC: end_booking_date の計算を p_tenant_id のバッファに合わせる（クライアント側の
-- CustomerBooking.tsx / TrialBooking.tsx が返り値をそのまま占有時間として使うため、ここが正確な
-- 発生源）。tenant_id IS NULL の旧データ行も同じ footprint を使う（従来どおりの簡略化）。
CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots(p_tenant_id uuid, from_date date, to_date date)
RETURNS TABLE(booking_date timestamp with time zone, end_booking_date timestamp with time zone, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  buffer_min integer;
  footprint interval;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.booking_buffer_minutes INTO buffer_min
  FROM public.tenants t WHERE t.id = p_tenant_id;
  footprint := make_interval(mins => 60 + COALESCE(buffer_min, 15));

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

-- 公開テナント情報RPC: 体験予約ページ(TrialBooking.tsx)が候補枠自身の占有時間
-- (60分+バッファ)を計算できるよう booking_buffer_minutes を追加で返す。
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);
CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
RETURNS TABLE (
  id uuid, gym_name text, gym_name_short text, address text,
  logo_url text, primary_color text, trial_info_title text, trial_info_body text,
  booking_buffer_minutes integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated;
