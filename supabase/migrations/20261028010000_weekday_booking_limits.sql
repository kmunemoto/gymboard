-- ============================================================================
-- 曜日ごとに会員の1日の上限を決める（2026-10-28）
--
-- 宗本さん（設定画面「1日の上限人数」のスクリーンショット）:
--   「これ、曜日ごとに上限設定できる様にもして」
-- 確認した2点:
--   1. 曜日ごとに会員の人数を決める（例: 月5・火6・水5・木6・金5・土6・日4）。
--      今の「週に何日か、上限を増やす」も一緒に使える（曜日の人数より多くできる）
--   2. 体験も含めた合計の上限（daily_total_limit）は **全曜日同じ** のまま
--
-- ## 設定の形（tenants.daily_booking_limit_weekdays）
--
--   {"0": 4, "2": 6}   キーは曜日（0=日曜〜6=土曜。operating_hours.days と同じ数え方）
--   キーの無い曜日は daily_booking_limit（共通）。NULL＝全曜日共通（今まで通り）。
--
-- ## 「週に何日か増やす」との組み合わせ
--
--   その日の会員の上限 =
--     その週（月〜日）の「ほかの日」で、上限を増やした日が weekly_peak_days 日未満 → weekly_peak_limit
--     それ以上                                                              → その曜日の上限
--
--   上限を増やした日 = 会員が **その曜日の上限を超えて** 入った日（上限を外した日は数えない）。
--   曜日の上限が weekly_peak_limit 以上の曜日は、増やさない（数えもしない）。
--
--   🔴 以前（20261022010000）は「weekly_peak_limit 人以上の日」を数えていた。
--      上限5・増やした日6 のように 1人差なら同じ意味（いま設定しているジムはこの形だけ）。
--      変えた理由:
--        - 曜日ごとに人数が違うと、もともと6人の曜日の6人目を「増やした日」に数えてしまう
--        - 上限4・増やした日6 だと、5人の日を数えず、どの日も5人まで入れてしまっていた
--
-- ## 変える関数
--
--   tenant_member_day_limits     … 曜日の上限を引く。会員のガード（tenant_day_closed）・
--                                  カレンダーの受付終了（get_tenant_closed_days）・残り枠が全部これを使う
--   get_tenant_daily_limit_left  … 「上限が何も無いジムは返さない」の判定に曜日の上限を足す
--
-- 合計の上限（tenant_day_total_reached / 体験予約ページ）は変えない（全曜日同じ）。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public。値の設定は画面か本番で直接行う）。
-- ============================================================================

-- ── (1) 設定の列 ────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS daily_booking_limit_weekdays jsonb;

COMMENT ON COLUMN public.tenants.daily_booking_limit_weekdays IS
  '曜日ごとの会員の1日の上限。{"0": 4, "2": 6}（0=日曜〜6=土曜）。キーの無い曜日は daily_booking_limit。NULL=全曜日共通（今まで通り）。体験込みの合計（daily_total_limit）は全曜日同じ';

-- 形の確認: オブジェクトで、キーは "0"〜"6"、値は 1〜99 の整数
-- 🔴 CHECK から呼ぶので、書く人（店のスタッフ）が実行できないと設定の保存が全部落ちる。
--    EXECUTE は外さない（引数しか見ない関数なので、誰が呼んでも害は無い）。
CREATE OR REPLACE FUNCTION public.weekday_limits_valid(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
  SELECT p IS NULL OR (
    jsonb_typeof(p) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(p) e
       WHERE e.key NOT IN ('0', '1', '2', '3', '4', '5', '6')
          OR CASE WHEN jsonb_typeof(e.value) = 'number' AND e.value::text ~ '^[0-9]{1,2}$'
                  THEN e.value::text::integer NOT BETWEEN 1 AND 99
                  ELSE true
             END
    )
  );
$fn$;
GRANT EXECUTE ON FUNCTION public.weekday_limits_valid(jsonb) TO anon, authenticated, service_role;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_daily_booking_limit_weekdays_valid;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_daily_booking_limit_weekdays_valid
  CHECK (public.weekday_limits_valid(daily_booking_limit_weekdays));

-- ── (2) その日の会員の上限（曜日の上限 ＋ 週の「多い日」） ────────────────────
-- member_limit: NULL=上限なし（曜日の上限も共通の上限も無い・その日だけ上限を外した日）
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
    SELECT x.daily_booking_limit AS lim, x.daily_booking_limit_weekdays AS wd,
           x.weekly_peak_limit AS peak, x.weekly_peak_days AS peak_days
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
  -- 日ごとの曜日の上限。曜日の指定が無ければ共通（daily_booking_limit）。
  -- 曜日は 0=日曜〜6=土曜（isodow は 1=月曜〜7=日曜なので 7 で割った余り）
  days AS (
    SELECT g::date AS day,
           date_trunc('week', g::timestamp)::date AS wk,
           COALESCE((t.wd ->> (extract(isodow FROM g::date)::integer % 7)::text)::integer, t.lim) AS base
      FROM t, span, generate_series(span.w0, span.w1, interval '1 day') AS g
  ),
  -- 上限を増やした日: 増やせる曜日（曜日の上限が weekly_peak_limit より少ない）で、
  -- 曜日の上限を超えて入った日。上限を外した日は数えない
  raised AS (
    SELECT d.day, d.wk
      FROM days d JOIN counts c ON c.day = d.day, t
     WHERE t.peak IS NOT NULL AND t.peak_days IS NOT NULL
       AND d.base IS NOT NULL AND d.base < t.peak
       AND c.n > d.base
       AND NOT EXISTS (SELECT 1 FROM uncapped x WHERE x.day = d.day)
  )
  SELECT d.day,
         CASE
           WHEN EXISTS (SELECT 1 FROM uncapped x WHERE x.day = d.day) THEN NULL
           WHEN d.base IS NULL THEN NULL
           WHEN t.peak IS NULL OR t.peak_days IS NULL OR t.peak <= d.base THEN d.base
           WHEN (SELECT count(*) FROM raised r WHERE r.wk = d.wk AND r.day <> d.day) < t.peak_days
             THEN t.peak
           ELSE d.base
         END,
         COALESCE((SELECT c.n FROM counts c WHERE c.day = d.day), 0)
    FROM t, days d
   WHERE d.day BETWEEN from_date AND to_date
   ORDER BY 1;
$fn$;
REVOKE ALL ON FUNCTION public.tenant_member_day_limits(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;

-- ── (3) 残り枠（その日に予約しているお客様だけに見せる数） ─────────────────
-- 本番の定義（2026-10-28 の pg_get_functiondef）から2か所だけ変えた:
--   - 「上限が何も無いジムは返さない」に曜日の上限を足す（共通が「上限なし」でも、曜日の上限があれば返す）
--   - 上限の無い日（その曜日も共通も上限なし・合計も無し）は返さない（画面は「無い日＝上限なし」と読む）。
--     今までの設定では、そういう日は出てこない（どちらかの上限が必ず効いていた）
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
  v_weekdays jsonb;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  IF v_uid IS NULL OR NOT public.is_tenant_member(p_tenant_id, v_uid) THEN
    RETURN;
  END IF;

  SELECT t.daily_booking_limit, t.daily_total_limit, NULLIF(t.daily_booking_limit_weekdays, '{}'::jsonb)
    INTO v_limit, v_total, v_weekdays
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_limit IS NULL AND v_total IS NULL AND v_weekdays IS NULL THEN
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
     AND (l.member_limit IS NOT NULL OR v_total IS NOT NULL)
   ORDER BY 1;
END;
$fn$;
REVOKE ALL ON FUNCTION public.get_tenant_daily_limit_left(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_daily_limit_left(uuid, date, date) TO authenticated;
