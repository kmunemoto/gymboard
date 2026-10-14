-- ============================================================================
-- 体験も含めた「1日の合計の上限」（2026-10-14）
--
-- 宗本さん:
--   「今、私のジムは一日4枠までしか取れませんが、体験の予約ではそれ以上取れます。
--    それを体験予約もその日がすでに5枠埋まっていれば体験予約も取れない様にしたい」
-- 確認した2点:
--   1. 会員も合計5で止めるか → 「合計5で止めます」
--   2. 「その日だけ上限を外す」をした日は合計の上限も外すか → 「外します」
--
-- ## 何が変わるか（daily_total_limit を設定した店だけ。NULL＝今まで通り）
--
--                        会員の自己予約          体験予約                店の代理予約
--   会員の上限(4)に達した   止まる（今まで通り）     通る（今まで通り）       通る
--   合計(5)に達した         **止まる**              **止まる**             通る
--   手で止めた日（赤）      止まる（今まで通り）     通る（合計に達するまで） 通る
--   上限を外した日          通る（両方とも外れる）   通る（両方とも外れる）   通る
--
--   合計 = 会員の予約（tenant_day_booking_count と同じ数え方）
--        + 体験・ドロップイン（trial_bookings のキャンセル済み以外）
--
-- 2026-09-01 の「体験予約は上限なく受け付けます」は、**合計の上限を設定していない店では
-- そのまま**。設定した店だけ、体験が合計の上限で止まる。
-- 2026-09-19 に戻した「手で止めた日は体験も止める」は**入れ直していない**
-- （赤い日でも体験は通る。合計に達したときだけ止まる）。
--
-- ## 🔴 判定は1か所（tenant_day_total_reached）
--
-- 会員のガード（tenant_day_closed）・体験のガード（trial_bookings のトリガー）・
-- 会員の予約カレンダー（get_tenant_closed_days）・体験予約ページ（get_tenant_trial_closed_days）・
-- 残り枠（get_tenant_daily_limit_left）がすべて同じ関数で数える。画面ごとに数え直すと
-- 「空きに見えるのに断られる」が起きる。
--
-- ## ドロップインは止めない（数えはする）
--
-- ドロップインは体験と同じ trial_bookings に入っている（booking_kind で区別）。
-- 合計には数えるが、ガードは booking_kind = 'trial' だけに掛ける。ドロップインのページは
-- この判定を見ていないので、止めると理由の分からない失敗になる（本番のドロップインは0件）。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public。値の設定は本番で直接行う）。
-- ============================================================================

-- ── (1) 設定の列 ────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS daily_total_limit integer;

COMMENT ON COLUMN public.tenants.daily_total_limit IS
  '体験も含めた1日の合計の上限。会員の予約＋体験・ドロップインの件数がこれに達した日は、会員の自己予約も体験予約も受け付けない。NULL=上限なし（体験は今まで通り上限なく受け付ける）。店側の代理予約には効かない。「その日だけ上限を外す」日は外れる';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_daily_total_limit_positive;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_daily_total_limit_positive
  CHECK (daily_total_limit IS NULL OR daily_total_limit >= 1);

-- ── (2) 体験・ドロップインの件数 ──────────────────────────────────────
-- 会員側（tenant_day_booking_count）と同じ形: キャンセル済み以外・JST の日付。
CREATE OR REPLACE FUNCTION public.tenant_day_trial_count(
  p_tenant_id uuid,
  p_date date,
  p_exclude_trial_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT count(*)::integer FROM public.trial_bookings x
   WHERE x.tenant_id = p_tenant_id
     AND x.status <> 'キャンセル済み'
     AND (p_exclude_trial_id IS NULL OR x.id <> p_exclude_trial_id)
     AND (x.booking_date AT TIME ZONE 'Asia/Tokyo')::date = p_date;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_day_trial_count(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

-- ── (3) 合計の上限に達しているか（判定はここだけ）───────────────────────
CREATE OR REPLACE FUNCTION public.tenant_day_total_reached(
  p_tenant_id uuid,
  p_date date,
  p_exclude_booking_id uuid DEFAULT NULL,
  p_exclude_trial_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_total integer;
BEGIN
  IF p_tenant_id IS NULL OR p_date IS NULL THEN
    RETURN false;
  END IF;

  SELECT t.daily_total_limit INTO v_total
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_total IS NULL THEN
    RETURN false;
  END IF;

  -- 🔴 その日だけ上限を外した日は、合計の上限も外す（2026-10-14 宗本さん「外します」）
  IF EXISTS (
    SELECT 1 FROM public.booking_uncapped_days u
     WHERE u.tenant_id = p_tenant_id AND u.uncapped_date = p_date
  ) THEN
    RETURN false;
  END IF;

  RETURN public.tenant_day_booking_count(p_tenant_id, p_date, p_exclude_booking_id)
       + public.tenant_day_trial_count(p_tenant_id, p_date, p_exclude_trial_id) >= v_total;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_day_total_reached(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── (4) 会員の自己予約: 合計の上限でも止める ─────────────────────────────
-- 引数は変えない（guard_booking_day_closed がこの形で呼んでいる）。中の順番も今まで通り:
-- 手で止めた日 → 上限を外した日 → 会員の上限 → （新）合計の上限。
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

  -- 🔴 手で止めた日が最優先。上限なしの指定より先に判定する。
  --    順番を入れ替えると「今日はもう受けない」と決めた日が勝手に開く。
  IF EXISTS (
    SELECT 1 FROM public.booking_closed_days d
     WHERE d.tenant_id = p_tenant_id AND d.closed_date = p_date
  ) THEN
    RETURN true;
  END IF;

  -- 🔴 この日だけ上限なし（2026-09-20）。会員の上限も合計の上限も見ない。
  IF EXISTS (
    SELECT 1 FROM public.booking_uncapped_days u
     WHERE u.tenant_id = p_tenant_id AND u.uncapped_date = p_date
  ) THEN
    RETURN false;
  END IF;

  SELECT t.daily_booking_limit INTO v_limit
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_limit IS NOT NULL
     AND public.tenant_day_booking_count(p_tenant_id, p_date, p_exclude_booking_id) >= v_limit THEN
    RETURN true;
  END IF;

  -- 体験も含めた合計の上限（2026-10-14 宗本さん「合計5で止めます」）
  RETURN public.tenant_day_total_reached(p_tenant_id, p_date, p_exclude_booking_id, NULL);
END;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_day_closed(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

-- ── (5) 体験予約: 合計の上限で止める ──────────────────────────────────
-- 🔴 手で止めた日（booking_closed_days）は**見ない**。2026-09-19 に「赤い日でも体験は
--    入れられる様にして」で戻している。tenant_day_closed() を呼ばないこと（あちらは
--    手で止めた日も会員の上限も true にする）。
CREATE OR REPLACE FUNCTION public.guard_trial_booking_day_full()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid;
BEGIN
  -- 取り込み（salute_sync）は過去分の流し込みなので素通しする（会員側と同じ作法）
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL OR NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  -- ドロップインは止めない（数えはする）。冒頭のコメント参照
  IF COALESCE(to_jsonb(NEW) ->> 'booking_kind', 'trial') <> 'trial' THEN
    RETURN NEW;
  END IF;

  -- 店側（オーナー・トレーナー）が入れる分は通す。会員予約の代理と同じ非対称
  v_actor := auth.uid();
  IF v_actor IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = NEW.tenant_id AND m.user_id = v_actor AND m.role IN ('owner', 'trainer')
  ) THEN
    RETURN NEW;
  END IF;

  -- ⚠️ 文面に「この時間帯」を入れないこと。trial-book が slot_taken と誤判定し
  --    「別の時間をお選びください」と案内してしまう。
  IF public.tenant_day_total_reached(NEW.tenant_id, (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date, NULL, NULL) THEN
    RAISE EXCEPTION 'この日はご予約の受付を終了しました' USING ERRCODE = 'GB007';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guard_trial_booking_day_full() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_trial_booking_day_full ON public.trial_bookings;
CREATE TRIGGER trg_guard_trial_booking_day_full
  BEFORE INSERT ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_trial_booking_day_full();

-- ── (6) 会員の予約カレンダー・予定表: 合計に達した日も「上限に達した日」として返す ──
-- 返り値の形は変えない（manual=false の行が増えるだけ）。会員の画面は「満」、
-- 予定表はオレンジ「上限に達しました」（押すとその日だけ上限なし＝両方外れる）になる。
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
  -- 🔴 この日だけ上限なし。下の判定で「上限で閉める」側からだけ外す。
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
      -- 体験も含めた合計の上限（2026-10-14）。上限を外した日は関数の中で false になる
      OR (v_total IS NOT NULL AND public.tenant_day_total_reached(p_tenant_id, d.day, NULL, NULL))
   ORDER BY d.day;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_tenant_closed_days(uuid, date, date) TO anon, authenticated;

-- ── (7) 体験予約ページ用: 合計の上限に達した日だけ ─────────────────────────
-- 体験予約ページはログイン不要。手で止めた日・会員の上限に達した日は**返さない**
-- （どちらも体験は通る）。返すのは「体験ももう受けない日」だけ。
CREATE OR REPLACE FUNCTION public.get_tenant_trial_closed_days(
  p_tenant_id uuid,
  from_date date,
  to_date date
)
RETURNS TABLE(closed_date date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.daily_total_limit IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT d::date
    FROM generate_series(from_date, to_date, interval '1 day') AS d
   WHERE public.tenant_day_total_reached(p_tenant_id, d::date, NULL, NULL)
   ORDER BY 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tenant_trial_closed_days(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_trial_closed_days(uuid, date, date) TO anon, authenticated;

-- ── (8) 残り枠（会員の予約カレンダーの「残N」）: 合計の上限も効かせる ────────────
-- 残り = min(会員の上限 − 会員の件数, 合計の上限 − 会員の件数 − 体験の件数)。
-- どちらも未設定なら何も返さない（＝時間だけで数える。今まで通り）。
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
  SELECT d::date,
         GREATEST(0, LEAST(
           CASE WHEN v_limit IS NULL THEN 2147483647
                ELSE v_limit - public.tenant_day_booking_count(p_tenant_id, d::date) END,
           CASE WHEN v_total IS NULL THEN 2147483647
                ELSE v_total - public.tenant_day_booking_count(p_tenant_id, d::date)
                             - public.tenant_day_trial_count(p_tenant_id, d::date) END
         ))::integer
    FROM generate_series(from_date, to_date, interval '1 day') AS d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.booking_uncapped_days u
      WHERE u.tenant_id = p_tenant_id AND u.uncapped_date = d::date
   )
   ORDER BY 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tenant_daily_limit_left(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_daily_limit_left(uuid, date, date) TO authenticated;
