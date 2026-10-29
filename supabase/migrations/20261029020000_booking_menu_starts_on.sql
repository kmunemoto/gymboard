-- ============================================================================
-- 予約メニューに「この日から予約できる」日（starts_on）を持たせる（2026-10-29）
-- ============================================================================
-- 宗本さん「（マシンピラティスは）今すぐ（オンに）だが、11/25 以降から予約は可能」。
-- メニューを今オンにして、お客様が開始日以降の日付を前もって予約できるようにする。
--
-- 開始日より前の日付（JST の予約日で比べる）は:
--   1. お客様ご自身の予約で、そのメニューを選べない（apply_booking_menu の GB012。新しいアプリ）
--   2. そのメニューの先生を指名できない（guard_booking_menu_teacher の GB002。メニューを送らない古いアプリ）
--   3. 担当のシフトの時間を専用にしない（menu_reserved_overlaps・get_tenant_booked_slots）。
--      🔴 始まる前から、トレーニング・体験の枠を塞がない
-- 店の代理予約・日時の変更（作り直し）は今まで通り通す。NULL は「すぐ」（今まで通り）。
--
-- 関数は本番の定義（pg_get_functiondef・2026-10-29）に、開始日の条件を足しただけ。
-- ============================================================================

ALTER TABLE public.booking_menus
  ADD COLUMN IF NOT EXISTS starts_on date;

COMMENT ON COLUMN public.booking_menus.starts_on IS
  'この日から予約できる（JST の予約日）。NULL はすぐ。開始日より前は、お客様がこのメニュー・この担当を選べず、'
  '担当のシフトの時間も専用にしない（店の代理予約・日時の変更は通す）。2026-10-29';

-- (3) 専用の時間に重なるか。開始日より前のメニューは専用にしない
CREATE OR REPLACE FUNCTION public.menu_reserved_overlaps(p_tenant_id uuid, p_start timestamptz, p_minutes integer)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE((SELECT t.menu_staff_hours_exclusive FROM public.tenants t WHERE t.id = p_tenant_id), false)
     AND EXISTS (
       SELECT 1
         FROM public.staff_schedules s
        WHERE s.tenant_id = p_tenant_id
          AND s.weekday = EXTRACT(DOW FROM (p_start AT TIME ZONE 'Asia/Tokyo'))::int
          AND EXISTS (
            SELECT 1 FROM public.booking_menus m
             WHERE m.tenant_id = p_tenant_id AND m.is_active AND m.staff_user_id = s.user_id
               AND (m.starts_on IS NULL OR m.starts_on <= (p_start AT TIME ZONE 'Asia/Tokyo')::date)
          )
          AND EXISTS (
            SELECT 1 FROM public.tenant_members tm
             WHERE tm.tenant_id = p_tenant_id AND tm.user_id = s.user_id
               AND tm.status = 'active' AND tm.role IN ('owner', 'trainer')
          )
          -- JST のその日の分で比べる（GB002 と同じ数え方）
          AND EXTRACT(HOUR FROM (p_start AT TIME ZONE 'Asia/Tokyo'))::int * 60
              + EXTRACT(MINUTE FROM (p_start AT TIME ZONE 'Asia/Tokyo'))::int
              < split_part(s.end_time, ':', 1)::int * 60 + split_part(s.end_time, ':', 2)::int
          AND split_part(s.start_time, ':', 1)::int * 60 + split_part(s.start_time, ':', 2)::int
              < EXTRACT(HOUR FROM (p_start AT TIME ZONE 'Asia/Tokyo'))::int * 60
                + EXTRACT(MINUTE FROM (p_start AT TIME ZONE 'Asia/Tokyo'))::int
                + GREATEST(COALESCE(p_minutes, 0), 0)
     );
$fn$;
REVOKE ALL ON FUNCTION public.menu_reserved_overlaps(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;

-- (1) 予約にメニューを当てる。開始日より前の日付は、お客様がそのメニューを選べない
CREATE OR REPLACE FUNCTION public.apply_booking_menu()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor       uuid := auth.uid();
  v_self        boolean;
  v_menu        public.booking_menus%ROWTYPE;
  v_session_min integer;
  v_buffer_min  integer;
BEGIN
  IF NEW.tenant_id IS NULL OR (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  -- お客様ご自身の予約か（店の代理予約・サービスロールは false）
  v_self := v_actor IS NOT NULL AND v_actor = NEW.user_id;

  IF NEW.menu_id IS NOT NULL THEN
    SELECT * INTO v_menu FROM public.booking_menus m WHERE m.id = NEW.menu_id;
    -- 別のジムのメニューは誰でも断る
    IF NOT FOUND OR v_menu.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'このメニューは予約できません' USING ERRCODE = 'GB012';
    END IF;
    -- 付け替え（UPDATE）は店の操作。担当は書き換えない（代わりの先生に替えた予約など）
    IF TG_OP = 'UPDATE' THEN
      RETURN NEW;
    END IF;
    -- 外したメニューはお客様が選べない（日時の変更の作り直し・戻しは通す）
    IF NOT v_menu.is_active AND v_self AND NEW.created_via IS DISTINCT FROM 'reschedule' THEN
      RAISE EXCEPTION 'このメニューは予約できません' USING ERRCODE = 'GB012';
    END IF;
    -- 開始日より前の日付もお客様が選べない（日時の変更の作り直しは通す・2026-10-29）
    IF v_menu.starts_on IS NOT NULL AND (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date < v_menu.starts_on
       AND v_self AND NEW.created_via IS DISTINCT FROM 'reschedule' THEN
      RAISE EXCEPTION 'このメニューは予約できません' USING ERRCODE = 'GB012';
    END IF;
    -- 担当のいるメニュー: お客様の予約は必ずその担当。代理予約は、担当を選んでいなければその担当
    IF v_menu.staff_user_id IS NOT NULL AND (v_self OR NEW.staff_user_id IS NULL) THEN
      NEW.staff_user_id := v_menu.staff_user_id;
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.staff_user_id IS NULL THEN
    -- メニューを送ってこない予約は、担当のいない先頭のメニュー（無ければ NULL のまま＝今まで通り）
    SELECT m.id INTO NEW.menu_id
      FROM public.booking_menus m
     WHERE m.tenant_id = NEW.tenant_id AND m.is_active AND m.staff_user_id IS NULL
     ORDER BY m.sort_order, m.created_at
     LIMIT 1;
  END IF;

  -- 専用の時間を見るのは、お客様ご自身の新しい予約だけ
  IF TG_OP <> 'INSERT' OR NOT v_self THEN
    RETURN NEW;
  END IF;

  -- 担当のいるメニューの担当の予約は、専用の時間に入ってよい（シフトは GB002 が見る）
  IF NEW.staff_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.booking_menus m
     WHERE m.tenant_id = NEW.tenant_id AND m.is_active AND m.staff_user_id = NEW.staff_user_id
  ) THEN
    RETURN NEW;
  END IF;

  -- 占有の長さは check_booking_overlap と同じ（プランの長さ＋オプション＋間）
  SELECT t.booking_buffer_minutes, t.slot_duration_minutes INTO v_buffer_min, v_session_min
    FROM public.tenants t WHERE t.id = NEW.tenant_id;
  SELECT COALESCE(
           (SELECT tp.slot_duration_minutes FROM public.tenant_plans tp
             WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type LIMIT 1),
           v_session_min, 60)
    INTO v_session_min;

  IF public.menu_reserved_overlaps(
       NEW.tenant_id, NEW.booking_date,
       v_session_min + GREATEST(COALESCE(NEW.option_minutes, 0), 0) + COALESCE(v_buffer_min, 15)) THEN
    RAISE EXCEPTION 'この時間は別のメニュー専用です' USING ERRCODE = 'GB011';
  END IF;

  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.apply_booking_menu() FROM PUBLIC, anon, authenticated;

-- (2) 古いアプリの指名。担当のメニューが「その日に予約できる」ものを1つも持たない先生は断る
CREATE OR REPLACE FUNCTION public.guard_booking_menu_teacher()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.staff_user_id IS NULL OR NEW.tenant_id IS NULL
     OR (to_jsonb(NEW) ->> 'source') = 'salute_sync'
     OR NEW.created_via IS NOT DISTINCT FROM 'reschedule' THEN
    RETURN NEW;
  END IF;

  -- お客様ご自身の予約だけ（店の代理予約・サーバーは見ない）
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
       SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = NEW.tenant_id AND tm.user_id = NEW.staff_user_id
          AND tm.role = 'trainer' AND tm.staff_access = 'limited'
     )
     AND EXISTS (
       SELECT 1 FROM public.booking_menus m
        WHERE m.tenant_id = NEW.tenant_id AND m.staff_user_id = NEW.staff_user_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.booking_menus m
        WHERE m.tenant_id = NEW.tenant_id AND m.staff_user_id = NEW.staff_user_id AND m.is_active
          AND (m.starts_on IS NULL OR m.starts_on <= (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date)
     ) THEN
    RAISE EXCEPTION 'この担当者は今は予約を受け付けていません（担当のメニューがオフ、または開始日より前）' USING ERRCODE = 'GB002';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_booking_menu_teacher() FROM PUBLIC, anon, authenticated;

-- (3) 画面が見る埋まり枠。開始日より前の日には「担当つきのブロック」（専用の時間）を出さない
CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots(p_tenant_id uuid, from_date date, to_date date)
RETURNS TABLE(
  booking_date timestamp with time zone,
  end_booking_date timestamp with time zone,
  status text,
  staff_user_id uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  buffer_min integer;
  tenant_session_min integer;
  v_exclusive boolean;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes, COALESCE(t.menu_staff_hours_exclusive, false)
    INTO buffer_min, tenant_session_min, v_exclusive
  FROM public.tenants t WHERE t.id = p_tenant_id;

  RETURN QUERY
  -- 体験・ドロップインはオプションを持たない（従来どおり）。
  SELECT tb.booking_date,
         tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_booking_date,
         tb.status,
         NULL::uuid AS staff_user_id
  FROM public.trial_bookings tb
  WHERE (tb.tenant_id = p_tenant_id OR tb.tenant_id IS NULL)
    AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT b.booking_date,
         b.booking_date + make_interval(mins =>
           COALESCE(tp.slot_duration_minutes, tenant_session_min, 60)
           + COALESCE(b.option_minutes, 0)
           + COALESCE(buffer_min, 15)
         ) AS end_booking_date,
         b.status,
         b.staff_user_id
  FROM public.bookings b
  LEFT JOIN public.tenant_plans tp
    ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
  WHERE (b.tenant_id = p_tenant_id OR b.tenant_id IS NULL)
    AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT bs.blocked_date AS booking_date,
         bs.end_blocked_date AS end_booking_date,
         'ブロック済み' AS status,
         NULL::uuid AS staff_user_id
  FROM public.blocked_slots bs
  WHERE (bs.tenant_id = p_tenant_id OR bs.tenant_id IS NULL)
    AND (bs.blocked_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  -- 🔴 担当のいるメニューの時間（専用）。menu_reserved_overlaps と同じ条件で並べる
  SELECT ((d.day::date + s.start_time::time) AT TIME ZONE 'Asia/Tokyo') AS booking_date,
         ((d.day::date + s.end_time::time) AT TIME ZONE 'Asia/Tokyo') AS end_booking_date,
         'ブロック済み' AS status,
         CASE WHEN auth.uid() IS NULL THEN NULL::uuid ELSE s.user_id END AS staff_user_id
  FROM generate_series(from_date::timestamp, to_date::timestamp, interval '1 day') AS d(day)
  JOIN public.staff_schedules s
    ON s.tenant_id = p_tenant_id
   AND s.weekday = EXTRACT(DOW FROM d.day)::int
  WHERE v_exclusive
    AND EXISTS (
      SELECT 1 FROM public.booking_menus m
       WHERE m.tenant_id = p_tenant_id AND m.is_active AND m.staff_user_id = s.user_id
         AND (m.starts_on IS NULL OR m.starts_on <= d.day::date)
    )
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = p_tenant_id AND tm.user_id = s.user_id
         AND tm.status = 'active' AND tm.role IN ('owner', 'trainer')
    );
END;
$function$;

-- 🔴 公開の体験予約ページ（未ログイン）もこの RPC を見る。塞ぐと予約ページが真っ白になる
GRANT EXECUTE ON FUNCTION public.get_tenant_booked_slots(uuid, date, date) TO anon, authenticated;
