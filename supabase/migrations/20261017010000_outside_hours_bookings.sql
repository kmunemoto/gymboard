-- 営業時間外の予約（店がイレギュラーで入れたもの）。2026-10-17
--
-- 宗本さん「イレギュラーで営業時間外に予約をジム側で手入力で入れられる機能」。
-- 決めたこと:
--   1. 時間外の予約は「1日の上限」（daily_booking_limit / daily_total_limit）に**数えない**
--      （店があえて足した枠なので、その日のお客様の予約枠を減らさない）
--   2. 定休日にも入れられる（画面側。DB はもともと営業時間・定休日を見ていない）
--
-- 営業時間はもともと画面だけが見ていて、DB には営業時間のチェックが無い。代理予約は
-- 受付しない時間帯（GB006）・1日の上限（GB007）・予約回数の制限（GB003）も通る。
-- 時間外の予約を止めていたのは「担当のシフト外（GB002）」だけ。
--
-- 🔴 印（outside_hours）は**店のスタッフ（owner / trainer）とサービスロールだけ**が付けられる。
--    お客様が自分の予約に付けられると、1日の上限をすり抜けられてしまう。
-- 🔴 テナント固有の値は入れない（本番の値は本番で直接設定する）。

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS outside_hours boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.outside_hours IS
  '営業時間外（または定休日）に店がイレギュラーで入れた予約。true のとき: 1日の上限に数えない／担当のシフト外でも入れられる。付けられるのは店のスタッフとサービスロールだけ（guard_booking_outside_hours_flag）';

-- 1) 印を付けられる人を絞る。お客様が付けようとしたら黙って外す（エラーにしない＝古い端末を壊さない）
CREATE OR REPLACE FUNCTION public.guard_booking_outside_hours_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NOT COALESCE(NEW.outside_hours, false) THEN
    NEW.outside_hours := false;
    RETURN NEW;
  END IF;

  -- 既に付いている印は、お客様の操作（キャンセル等）で外れも付きもしない
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.outside_hours, false) THEN
    RETURN NEW;
  END IF;

  -- サービスロール（Edge Function など）
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NOT NULL
     AND public.has_tenant_role(NEW.tenant_id, v_actor, ARRAY['owner', 'trainer']) THEN
    RETURN NEW;
  END IF;

  NEW.outside_hours := false;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guard_booking_outside_hours_flag() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_outside_hours_flag ON public.bookings;
CREATE TRIGGER trg_guard_booking_outside_hours_flag
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_outside_hours_flag();

-- 2) 担当のシフト外（GB002）: 時間外の予約は見ない。
--    印を見るだけでなく、入れた人が店のスタッフかも見る（トリガーの実行順に頼らない）。
CREATE OR REPLACE FUNCTION public.guard_booking_staff_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff     UUID;
  v_old_staff UUID;
  v_jst       TIMESTAMP;
  v_dow       INT;
  v_min       INT;
  v_has_shift BOOLEAN;
  v_ok        BOOLEAN;
BEGIN
  v_staff := (to_jsonb(NEW) ->> 'staff_user_id')::uuid;
  IF v_staff IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_old_staff := (to_jsonb(OLD) ->> 'staff_user_id')::uuid;
    IF v_staff IS NOT DISTINCT FROM v_old_staff THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 🔴 営業時間外の予約（店がイレギュラーで入れたもの）はシフトを見ない（2026-10-17）
  IF COALESCE((to_jsonb(NEW) ->> 'outside_hours')::boolean, false)
     AND (auth.uid() IS NULL
          OR public.has_tenant_role(NEW.tenant_id, auth.uid(), ARRAY['owner', 'trainer'])) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.staff_schedules s
     WHERE s.tenant_id = NEW.tenant_id AND s.user_id = v_staff
  ) INTO v_has_shift;

  IF NOT v_has_shift THEN
    RETURN NEW;
  END IF;

  v_jst := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo');
  v_dow := EXTRACT(DOW FROM v_jst)::int;
  v_min := EXTRACT(HOUR FROM v_jst)::int * 60 + EXTRACT(MINUTE FROM v_jst)::int;

  SELECT EXISTS (
    SELECT 1 FROM public.staff_schedules s
     WHERE s.tenant_id = NEW.tenant_id
       AND s.user_id   = v_staff
       AND s.weekday   = v_dow
       AND v_min >= (split_part(s.start_time, ':', 1)::int * 60 + split_part(s.start_time, ':', 2)::int)
       AND v_min <  (split_part(s.end_time,   ':', 1)::int * 60 + split_part(s.end_time,   ':', 2)::int)
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'この担当者はその時間帯のシフトに入っていません'
      USING ERRCODE = 'GB002';
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) 1日の上限の数え方: 時間外の予約は数えない（決めたこと 1）
CREATE OR REPLACE FUNCTION public.tenant_day_booking_count(
  p_tenant_id uuid,
  p_date date,
  p_exclude_booking_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::integer FROM public.bookings b
   WHERE b.tenant_id = p_tenant_id
     AND b.status <> 'キャンセル済み'
     AND NOT b.outside_hours
     AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
     AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = p_date;
$function$;

-- get_tenant_closed_days は件数をその場で数えているので、同じく時間外を除く
CREATE OR REPLACE FUNCTION public.get_tenant_closed_days(
  p_tenant_id uuid,
  from_date date,
  to_date date
)
RETURNS TABLE(closed_date date, manual boolean, reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer;
  v_total integer;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.daily_booking_limit, t.daily_total_limit INTO v_limit, v_total
    FROM public.tenants t WHERE t.id = p_tenant_id;

  RETURN QUERY
  WITH days AS (
    SELECT d::date AS day FROM generate_series(from_date, to_date, interval '1 day') AS d
  ),
  manual AS (
    SELECT c.closed_date AS day, c.reason AS why
      FROM public.booking_closed_days c
     WHERE c.tenant_id = p_tenant_id
       AND c.closed_date BETWEEN from_date AND to_date
  ),
  uncapped AS (
    SELECT u.uncapped_date AS day
      FROM public.booking_uncapped_days u
     WHERE u.tenant_id = p_tenant_id
       AND u.uncapped_date BETWEEN from_date AND to_date
  ),
  totals AS (
    SELECT (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date AS day, count(*) AS n
      FROM public.bookings b
     WHERE b.tenant_id = p_tenant_id
       AND b.status <> 'キャンセル済み'
       AND NOT b.outside_hours
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
     GROUP BY 1
  )
  SELECT d.day, (m.day IS NOT NULL), m.why
    FROM days d
    LEFT JOIN manual m ON m.day = d.day
    LEFT JOIN uncapped u ON u.day = d.day
    LEFT JOIN totals tt ON tt.day = d.day
   WHERE m.day IS NOT NULL
      OR (v_limit IS NOT NULL AND COALESCE(tt.n, 0) >= v_limit AND u.day IS NULL)
      OR (v_total IS NOT NULL AND public.tenant_day_total_reached(p_tenant_id, d.day, NULL, NULL))
   ORDER BY d.day;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_closed_days(uuid, date, date) TO anon, authenticated;
