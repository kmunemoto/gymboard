-- ============================================================================
-- 週に何日かだけ、会員の1日の上限を増やす（2026-10-22）
--
-- 宗本さん:
--   「1週間に受ける予約の数を2つ増やします。基本一日5枠までにして、週に2日5枠が
--    埋まったら他の曜日は枠の上限を自動で4枠までにする。体験予約はこれに影響されません」
-- 確認した2点:
--   1. 1週間は **月曜〜日曜**
--   2. 会員が5人入った日も、合計の上限（体験込み・daily_total_limit）は **そのまま**
--      （会員5人の日は体験は入らない。体験は「多い日」の数には入らない）
--
-- ## 何が変わるか（weekly_peak_limit / weekly_peak_days を両方設定した店だけ。NULL＝今まで通り）
--
--   その日の会員の上限 =
--     その週（月〜日）の「ほかの日」で、会員が weekly_peak_limit 人以上の日が
--       weekly_peak_days 日未満 → weekly_peak_limit（例 5）
--       weekly_peak_days 日以上 → daily_booking_limit（例 4）
--
--   例（4 / 5 / 週2日）: 月・火に5人入ったら、水〜日は4人まで。
--   火のキャンセルで4人に戻れば、ほかの日がまた5人まで取れる（その場で数え直すだけ）。
--
-- 数え方は今まで通り（tenant_day_booking_count と同じ）: キャンセル済み以外・営業時間外を除く・
-- 店の代理予約も数える。体験・ドロップイン（trial_bookings）は数えない。
-- 「その日だけ上限を外す」日は上限なしのまま、**多い日の数にも入れない**。
--
-- 止まるのは今まで通り**会員の自己予約だけ**（guard_booking_day_closed）。店の代理予約・体験は通る。
--
-- ## 🔴 上限の計算は1か所（tenant_member_day_limits）
--
-- 会員のガード（tenant_day_closed）・予約カレンダー（get_tenant_closed_days）・
-- 残り枠（get_tenant_daily_limit_left）がすべてこの関数で上限を出す。
-- 画面ごとに計算すると「空きに見えるのに断られる」が起きる。
--
-- ## 🔴 同時に2人が別の日の5人目を取る
--
-- 「多い日」があと1日のときに、月と水の5人目が同時に来ると、どちらも「まだ1日」と数えて
-- 両方通ってしまう。会員のガードで**その店のその週**のロックを取ってから数える。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public。値の設定は本番で直接行う）。
-- ============================================================================

-- ── (1) 設定の列 ────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS weekly_peak_limit integer;
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS weekly_peak_days integer;

COMMENT ON COLUMN public.tenants.weekly_peak_limit IS
  '週に weekly_peak_days 日まで、会員の1日の上限をこの人数に増やす（daily_booking_limit より大きい値）。週は月曜〜日曜。NULL=増やさない（今まで通り）';
COMMENT ON COLUMN public.tenants.weekly_peak_days IS
  '会員の1日の上限を weekly_peak_limit に増やせる日数（週に・月曜〜日曜）。その週に weekly_peak_limit 人入った日がこの日数に達したら、残りの日は daily_booking_limit。NULL=増やさない';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_weekly_peak_limit_positive;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_weekly_peak_limit_positive
  CHECK (weekly_peak_limit IS NULL OR weekly_peak_limit >= 1);
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_weekly_peak_days_range;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_weekly_peak_days_range
  CHECK (weekly_peak_days IS NULL OR weekly_peak_days BETWEEN 1 AND 6);

-- ── (2) 会員の件数を日ごとに ──────────────────────────────────────────
-- 🔴 数え方は tenant_day_booking_count と同じにすること（キャンセル済み以外・営業時間外を除く・JST の日付）。
CREATE OR REPLACE FUNCTION public.tenant_member_day_counts(
  p_tenant_id uuid,
  from_date date,
  to_date date,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS TABLE(day date, n integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date, count(*)::integer
    FROM public.bookings b
   WHERE b.tenant_id = p_tenant_id
     AND b.status <> 'キャンセル済み'
     AND NOT b.outside_hours
     AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
     AND b.booking_date >= (from_date::timestamp AT TIME ZONE 'Asia/Tokyo')
     AND b.booking_date <  ((to_date + 1)::timestamp AT TIME ZONE 'Asia/Tokyo')
   GROUP BY 1;
$fn$;
REVOKE ALL ON FUNCTION public.tenant_member_day_counts(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;

-- ── (3) その日の会員の上限（週の「多い日」を反映） ───────────────────────
-- member_limit: NULL=上限なし（会員の上限が未設定・その日だけ上限を外した日）
-- booked:       その日の会員の件数
CREATE OR REPLACE FUNCTION public.tenant_member_day_limits(
  p_tenant_id uuid,
  from_date date,
  to_date date,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS TABLE(day date, member_limit integer, booked integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH t AS (
    SELECT x.daily_booking_limit AS lim, x.weekly_peak_limit AS peak, x.weekly_peak_days AS peak_days
      FROM public.tenants x WHERE x.id = p_tenant_id
  ),
  -- 範囲の両端を含む週（月曜〜日曜）をまるごと数える。範囲の外の日も「多い日」になりうる
  span AS (
    SELECT date_trunc('week', from_date::timestamp)::date AS w0,
           date_trunc('week', to_date::timestamp)::date + 6 AS w1
  ),
  counts AS (
    SELECT c.day, c.n
      FROM span, public.tenant_member_day_counts(p_tenant_id, span.w0, span.w1, p_exclude_booking_id) c
  ),
  uncapped AS (
    SELECT u.uncapped_date AS day
      FROM public.booking_uncapped_days u, span
     WHERE u.tenant_id = p_tenant_id
       AND u.uncapped_date BETWEEN span.w0 AND span.w1
  ),
  -- 「多い日」の上限まで埋まった日（上限を外した日は数えない）
  peak AS (
    SELECT c.day, date_trunc('week', c.day::timestamp)::date AS wk
      FROM counts c, t
     WHERE t.peak IS NOT NULL
       AND c.n >= t.peak
       AND NOT EXISTS (SELECT 1 FROM uncapped x WHERE x.day = c.day)
  )
  SELECT d::date,
         CASE
           WHEN EXISTS (SELECT 1 FROM uncapped x WHERE x.day = d::date) THEN NULL
           WHEN t.lim IS NULL THEN NULL
           WHEN t.peak IS NULL OR t.peak_days IS NULL OR t.peak <= t.lim THEN t.lim
           WHEN (SELECT count(*) FROM peak p
                  WHERE p.wk = date_trunc('week', d::timestamp)::date AND p.day <> d::date) < t.peak_days
             THEN t.peak
           ELSE t.lim
         END,
         COALESCE((SELECT c.n FROM counts c WHERE c.day = d::date), 0)
    FROM t, generate_series(from_date, to_date, interval '1 day') AS d
   ORDER BY 1;
$fn$;
REVOKE ALL ON FUNCTION public.tenant_member_day_limits(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;

-- ── (4) 会員の自己予約の判定 ──────────────────────────────────────────
-- 引数は変えない（guard_booking_day_closed がこの形で呼んでいる）。順番も今まで通り:
-- 手で止めた日 → 上限を外した日 → 会員の上限（ここが週の多い日を見るようになった）→ 合計の上限。
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
  v_limit  integer;
  v_booked integer;
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

  IF EXISTS (
    SELECT 1 FROM public.booking_uncapped_days u
     WHERE u.tenant_id = p_tenant_id AND u.uncapped_date = p_date
  ) THEN
    RETURN false;
  END IF;

  SELECT l.member_limit, l.booked INTO v_limit, v_booked
    FROM public.tenant_member_day_limits(p_tenant_id, p_date, p_date, p_exclude_booking_id) l;
  IF v_limit IS NOT NULL AND v_booked >= v_limit THEN
    RETURN true;
  END IF;

  RETURN public.tenant_day_total_reached(p_tenant_id, p_date, p_exclude_booking_id, NULL);
END;
$fn$;
REVOKE ALL ON FUNCTION public.tenant_day_closed(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

-- ── (5) 会員の自己予約のガード: その店のその週のロックを取ってから数える ─────────
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
  -- 🔴 同じ店・同じ週の自己予約を1件ずつ通す（週の「多い日」の数え違いを防ぐ）。
  --    トランザクションの終わりで自動的に外れる。
  PERFORM pg_advisory_xact_lock(
    hashtextextended('booking_week:' || NEW.tenant_id::text || ':' || date_trunc('week', v_date::timestamp)::date::text, 0)
  );
  IF public.tenant_day_closed(NEW.tenant_id, v_date, NEW.id) THEN
    RAISE EXCEPTION 'この日はご予約の受付を終了しました' USING ERRCODE = 'GB007';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guard_booking_day_closed() FROM PUBLIC, anon, authenticated;

-- ── (6) 会員の予約カレンダー・予定表: 受付終了の日 ─────────────────────────
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
  v_total integer;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.daily_total_limit INTO v_total
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
  limits AS (
    SELECT l.day, l.member_limit, l.booked
      FROM public.tenant_member_day_limits(p_tenant_id, from_date, to_date, NULL) l
  )
  SELECT d.day, (m.day IS NOT NULL), m.why
    FROM days d
    LEFT JOIN manual m ON m.day = d.day
    LEFT JOIN limits l ON l.day = d.day
   WHERE m.day IS NOT NULL
      OR (l.member_limit IS NOT NULL AND l.booked >= l.member_limit)
      OR (v_total IS NOT NULL AND public.tenant_day_total_reached(p_tenant_id, d.day, NULL, NULL))
   ORDER BY d.day;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.get_tenant_closed_days(uuid, date, date) TO anon, authenticated;

-- ── (7) 残り枠（その日に予約しているお客様だけに見せる数） ─────────────────
-- min(その日の会員の上限 − 会員, 合計の上限 − 会員 − 体験)。上限を外した日は返さない。
CREATE OR REPLACE FUNCTION public.get_tenant_daily_limit_left(
  p_tenant_id uuid,
  from_date date,
  to_date date
)
RETURNS TABLE(limit_date date, left_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer;
  v_total integer;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  IF v_uid IS NULL OR NOT public.is_tenant_member(p_tenant_id, v_uid) THEN
    RETURN;
  END IF;

  SELECT t.daily_booking_limit, t.daily_total_limit INTO v_limit, v_total
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_limit IS NULL AND v_total IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT l.day,
         GREATEST(0, LEAST(
           CASE WHEN l.member_limit IS NULL THEN 2147483647
                ELSE l.member_limit - l.booked END,
           CASE WHEN v_total IS NULL THEN 2147483647
                ELSE v_total - l.booked - public.tenant_day_trial_count(p_tenant_id, l.day) END
         ))::integer
    FROM public.tenant_member_day_limits(p_tenant_id, from_date, to_date, NULL) l
   WHERE NOT EXISTS (
     SELECT 1 FROM public.booking_uncapped_days u
      WHERE u.tenant_id = p_tenant_id AND u.uncapped_date = l.day
   )
   ORDER BY 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_tenant_daily_limit_left(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_daily_limit_left(uuid, date, date) TO authenticated;
