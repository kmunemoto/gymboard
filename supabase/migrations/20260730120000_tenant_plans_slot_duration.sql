-- 予約の「1セッションの長さ」をプランごとに設定可能にする。
-- 既定は null（＝ジムの既定値 tenants.slot_duration_minutes を継承）で、
-- 未設定のプラン・既存の予約の占有時間計算は一切変わらない。
-- 60分プランと30分プランを同じジムに混在させたいケース（例:「月4回」と「月4回(30分)」）
-- 向け。cycle_months/grace_days と同じ「null=継承」の作法。

ALTER TABLE public.tenant_plans
  ADD COLUMN IF NOT EXISTS slot_duration_minutes integer;

COMMENT ON COLUMN public.tenant_plans.slot_duration_minutes IS
  'このプランの予約1件あたりの占有時間（分）。null/未設定はジムの既定値（tenants.slot_duration_minutes）を継承する。';

-- 重複防止トリガー: 占有時間を「予約自身のプラン（bookings.booking_type =
-- tenant_plans.plan_name）の slot_duration_minutes」で計算するよう変更。
-- プランに設定が無い/該当プランが見つからない（体験予約・プラン削除後の古い予約等）場合は
-- 従来どおりジムの既定値にフォールバックする。
-- 比較対象の既存予約側も同じ解決を行う（LEFT JOIN）ので、長さの異なるプラン同士が
-- 隣接して予約されたときも正しく重複判定できる。
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
  tenant_session_min integer;
  new_session_min integer;
  new_footprint interval;
BEGIN
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = NEW.tenant_id;

  SELECT tp.slot_duration_minutes INTO new_session_min
  FROM public.tenant_plans tp
  WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type
  LIMIT 1;
  new_session_min := COALESCE(new_session_min, tenant_session_min, 60);

  new_footprint := make_interval(mins => new_session_min + COALESCE(buffer_min, 15));
  new_start := NEW.booking_date;
  new_end := NEW.booking_date + new_footprint;

  SELECT COUNT(*) INTO overlap_count
  FROM (
    SELECT b.booking_date AS start_at,
           b.booking_date + make_interval(mins =>
             COALESCE(tp.slot_duration_minutes, tenant_session_min, 60) + COALESCE(buffer_min, 15)
           ) AS end_at
    FROM public.bookings b
    LEFT JOIN public.tenant_plans tp
      ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
    WHERE b.status != 'キャンセル済み'
      AND b.id IS DISTINCT FROM NEW.id
      AND b.tenant_id = NEW.tenant_id
      AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT tb.booking_date AS start_at,
           tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_at
    FROM public.trial_bookings tb
    WHERE tb.status != 'キャンセル済み'
      AND tb.id IS DISTINCT FROM NEW.id
      AND tb.tenant_id = NEW.tenant_id
      AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
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

-- 埋まり枠取得RPC: end_booking_date の計算も、通常予約（bookings）は
-- 自分のプランの slot_duration_minutes を使うよう変更。体験予約・ブロックは従来どおり
-- （体験予約はプランに紐付かないためジムの既定値、ブロックは元々明示的な終了時刻を持つ）。
CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots(p_tenant_id uuid, from_date date, to_date date)
RETURNS TABLE(booking_date timestamp with time zone, end_booking_date timestamp with time zone, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  buffer_min integer;
  tenant_session_min integer;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = p_tenant_id;

  RETURN QUERY
  SELECT tb.booking_date,
         tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_booking_date,
         tb.status
  FROM public.trial_bookings tb
  WHERE (tb.tenant_id = p_tenant_id OR tb.tenant_id IS NULL)
    AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT b.booking_date,
         b.booking_date + make_interval(mins =>
           COALESCE(tp.slot_duration_minutes, tenant_session_min, 60) + COALESCE(buffer_min, 15)
         ) AS end_booking_date,
         b.status
  FROM public.bookings b
  LEFT JOIN public.tenant_plans tp
    ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
  WHERE (b.tenant_id = p_tenant_id OR b.tenant_id IS NULL)
    AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT bs.blocked_date AS booking_date, bs.end_blocked_date AS end_booking_date, 'ブロック済み' AS status
  FROM public.blocked_slots bs
  WHERE (bs.tenant_id = p_tenant_id OR bs.tenant_id IS NULL)
    AND (bs.blocked_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date;
END;
$function$;
