-- 体験予約を「その日の受付を止める」仕組みから完全に外す（2026-09-01）
--
-- 宗本さんの指示:「体験予約はこのシステムの例外にします。体験予約は上限なく受け付けます」
-- 数え方も確認済み:「数えない（仕組みから完全に外す）」。
--
-- したがって体験予約は:
--   ・受付を止めた日でも入る（トリガーで止めない）
--   ・1日の人数にも数えない（上限の計算に入れない）
--
-- 🔴 ドロップイン予約も一緒に外れる。
--    ドロップインは体験と**同じ trial_bookings テーブル**に入っており
--    （booking_kind で区別）、クライアント側は両者を区別せず "trial-guest" として
--    扱っている。DB だけ booking_kind で分けると、画面の人数と DB の判定がずれる
--    ——このリポジトリで最も避けたい種類のズレ（画面は空きと見せるのに DB が拒否する）。
--    本番のドロップイン予約は全テナントで0件なので、テーブルごと外すほうが安全。
--    将来ドロップインを使い始めて分けたくなったら、useBookings が booking_kind を
--    運ぶようにしてから DB とクライアントを同時に変えること。
--
-- 20260901000000_booking_daily_cap.sql の3か所を差し替える。

-- ── (1) 体験のガードを外す ────────────────────────────────────────────
-- 受付を止めた日でも、体験・ドロップインは今までどおり入る。
DROP TRIGGER IF EXISTS trg_guard_trial_booking_day_closed ON public.trial_bookings;
DROP FUNCTION IF EXISTS public.guard_trial_booking_day_closed();

-- ── (2) 人数の数え方から体験を外す ──────────────────────────────────
-- 引数も減らす（体験を数えないので、体験行を除外する引数に意味が無くなる）。
-- 依存している tenant_day_closed を先に落としてから作り直す。
DROP FUNCTION IF EXISTS public.tenant_day_closed(uuid, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.tenant_day_booking_count(uuid, date, uuid, uuid);

CREATE OR REPLACE FUNCTION public.tenant_day_booking_count(
  p_tenant_id uuid,
  p_date date,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT count(*)::integer FROM public.bookings b
   WHERE b.tenant_id = p_tenant_id
     AND b.status <> 'キャンセル済み'
     AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
     AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = p_date;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_day_booking_count(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tenant_day_closed(
  p_tenant_id uuid,
  p_date date,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF p_tenant_id IS NULL OR p_date IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.booking_closed_days d
     WHERE d.tenant_id = p_tenant_id AND d.closed_date = p_date
  ) THEN
    RETURN true;
  END IF;

  SELECT t.daily_booking_limit INTO v_limit
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_limit IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.tenant_day_booking_count(p_tenant_id, p_date, p_exclude_booking_id) >= v_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_day_closed(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

-- 引数が減ったので、呼び出している会員予約のガードも作り直す（中身は同じ）。
CREATE OR REPLACE FUNCTION public.guard_booking_day_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor UUID;
  v_date  date;
BEGIN
  IF NEW.source = 'salute_sync' THEN
    RETURN NEW;
  END IF;
  v_actor := auth.uid();
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS NULL OR NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;
  v_date := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date;
  IF public.tenant_day_closed(NEW.tenant_id, v_date, NEW.id) THEN
    RAISE EXCEPTION 'この日はご予約の受付を終了しました' USING ERRCODE = 'GB007';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guard_booking_day_closed() FROM PUBLIC, anon, authenticated;

-- ── (3) 公開RPC からも体験を外す ────────────────────────────────────
-- 会員予約だけを数える。体験は何件入っても「受付終了の日」を作らない。
CREATE OR REPLACE FUNCTION public.get_tenant_closed_days(
  p_tenant_id uuid,
  from_date date,
  to_date date
)
RETURNS TABLE(closed_date date, manual boolean, reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.daily_booking_limit INTO v_limit
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
  totals AS (
    SELECT (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date AS day, count(*) AS n
      FROM public.bookings b
     WHERE b.tenant_id = p_tenant_id
       AND b.status <> 'キャンセル済み'
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
     GROUP BY 1
  )
  SELECT d.day, (m.day IS NOT NULL), m.why
    FROM days d
    LEFT JOIN manual m ON m.day = d.day
    LEFT JOIN totals tt ON tt.day = d.day
   WHERE m.day IS NOT NULL
      OR (v_limit IS NOT NULL AND COALESCE(tt.n, 0) >= v_limit)
   ORDER BY d.day;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_tenant_closed_days(uuid, date, date) TO anon, authenticated;
