-- ============================================================================
-- メニューの体験予約（例: マシンピラティス専用の体験予約ページ）。2026-10-31
-- ============================================================================
--
-- 宗本さん「マシンピラティス専用の体験予約受付サイトをつくってほしい。
--           マシンピラティスの時間の枠だけが表示されるように」
-- 確認して決めたこと:
--   1. 料金・案内文はメニューごとに持つ（トレーニングの体験の案内文は「体験トレーニングの料金は…」
--      なので流用できない）。宗本さんのジムはトレーニングと同じ ¥3,000（本番で入れる）
--   2. 受付期間は体験と同じ「N日先まで」。ただし開始日（starts_on）がまだ先のメニューは、
--      開始日の前日を「今日」とみなす（開始日から N 日分を前もって受け付ける。src/lib/menuTrial.ts）
--   3. 担当（先生）の予約になる。担当のシフトの時間だけ。専用の時間（menu_staff_hours_exclusive）にも入る
--      （担当のいるメニューの会員の予約と同じ。apply_booking_menu）
--
-- ## 形
--
--   booking_menus.trial_enabled / trial_price_yen / trial_info_title / trial_info_body
--   trial_bookings.menu_id / staff_user_id   … メニューの体験だけに入る（トレーニングの体験・ドロップインは NULL）
--   公開ページ /trial/:tenantId/menu/:menuId … get_menu_trial_public（メニュー・シフト・案内）と
--                                              get_menu_trial_slots（埋まり枠）を読む
--
-- ## 🔴 メニューの体験は「担当のいるメニューの予約」と同じ扱いにする
--
--   | | トレーニングの体験 | メニューの体験 |
--   |---|---|---|
--   | 専用の時間（guard_trial_menu_reserved） | 入れない | 入れる（担当の時間なので） |
--   | 担当のシフト（apply_trial_menu） | 見ない | シフトの中だけ（シフトの無い担当は営業時間どおり・GB002 と同じ） |
--   | 担当の重なり（check_booking_overlap の GB001） | 見ない | 見る（先生は同時に2人を見られない） |
--   | 時間ブロック（trial_ignores_blocked_slots） | 店の設定しだい | **いつも効く**（先生のお休みを時間ブロックで塞ぐため） |
--
--   - 担当はメニューで決まる（apply_trial_menu が入れる。送ってきた値は使わない）。
--     🔴 トリガーは名前の順に動くので、重なりの検査（prevent_trial_booking_overlap）より前に動く名前にする
--   - 会員の予約画面（担当のいるメニュー）が先生の体験と重ならないよう、get_tenant_booked_slots の
--     体験の行にも担当を返す（担当の重なりは画面でも見ている。src/lib/bookingOptionFit.ts）
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public）。設定は本番で直接入れる。
-- ============================================================================

-- ── (1) 列 ────────────────────────────────────────────────────────────────
ALTER TABLE public.booking_menus
  ADD COLUMN IF NOT EXISTS trial_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_price_yen integer,
  ADD COLUMN IF NOT EXISTS trial_info_title text,
  ADD COLUMN IF NOT EXISTS trial_info_body text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_menus_trial_price_yen_range') THEN
    ALTER TABLE public.booking_menus
      ADD CONSTRAINT booking_menus_trial_price_yen_range
      CHECK (trial_price_yen IS NULL OR (trial_price_yen >= 0 AND trial_price_yen <= 1000000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_menus_trial_info_length') THEN
    ALTER TABLE public.booking_menus
      ADD CONSTRAINT booking_menus_trial_info_length
      CHECK (char_length(COALESCE(trial_info_title, '')) <= 60 AND char_length(COALESCE(trial_info_body, '')) <= 2000);
  END IF;
END $$;

COMMENT ON COLUMN public.booking_menus.trial_enabled IS
  'このメニューの体験予約ページ（/trial/:tenantId/menu/:menuId）で予約を受けるか。担当のいるメニューだけで効く';
COMMENT ON COLUMN public.booking_menus.trial_price_yen IS
  'このメニューの体験の料金（税込・円）。NULL は「料金を表示しない」で 0 とは違う（tenants.trial_price_yen と同じ）';
COMMENT ON COLUMN public.booking_menus.trial_info_title IS
  'このメニューの体験予約ページの案内の見出し。空なら案内を出さない（トレーニングの体験の文章は使わない）';
COMMENT ON COLUMN public.booking_menus.trial_info_body IS
  'このメニューの体験予約ページの案内文';

-- 🔴 外部キーは ON DELETE の動作を付けない（bookings.menu_id と同じ。体験に使われたメニューは消せない）。
--    delete_my_gym は trial_bookings を booking_menus より先に消している（20261028030100）。
ALTER TABLE public.trial_bookings
  ADD COLUMN IF NOT EXISTS menu_id uuid REFERENCES public.booking_menus(id),
  ADD COLUMN IF NOT EXISTS staff_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_trial_bookings_menu_id ON public.trial_bookings (menu_id) WHERE menu_id IS NOT NULL;

COMMENT ON COLUMN public.trial_bookings.menu_id IS
  'メニューの体験のメニュー（booking_menus）。NULL はトレーニングの体験・ドロップイン';
COMMENT ON COLUMN public.trial_bookings.staff_user_id IS
  'メニューの体験の担当。apply_trial_menu がメニューから入れる（menu_id が NULL なら必ず NULL）';

-- ── (2) そのメニューの体験を受け付けているか ─────────────────────────────────
-- オンのメニュー × 体験オン × 担当がジムの現役のスタッフ × ジムが営業中（trial-book と同じ active/trial）
CREATE OR REPLACE FUNCTION public.menu_trial_open(p_menu_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.booking_menus m
      JOIN public.tenants t ON t.id = m.tenant_id
     WHERE m.id = p_menu_id
       AND m.is_active AND m.trial_enabled AND m.staff_user_id IS NOT NULL
       AND t.status IN ('active', 'trial')
       AND EXISTS (
         SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = m.tenant_id AND tm.user_id = m.staff_user_id
            AND tm.status = 'active' AND tm.role IN ('owner', 'trainer')
       )
  );
$fn$;
REVOKE ALL ON FUNCTION public.menu_trial_open(uuid) FROM PUBLIC, anon, authenticated;

-- ── (3) 体験にメニューを当てる（担当・開始日・シフト）────────────────────────────
-- 🔴 名前は trial_bookings の BEFORE トリガーの中でいちばん先に動くもの（名前の順に動く）。
--    担当を入れてから、重なり（prevent_trial_booking_overlap の GB001）・専用の時間が見る。
CREATE OR REPLACE FUNCTION public.apply_trial_menu()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_menu public.booking_menus%ROWTYPE;
  v_jst  timestamp;
  v_min  integer;
  v_ok   boolean;
BEGIN
  IF NEW.menu_id IS NULL THEN
    -- トレーニングの体験・ドロップインは担当を持たない（担当はメニューでしか決まらない）
    NEW.staff_user_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO v_menu FROM public.booking_menus m WHERE m.id = NEW.menu_id;
  IF NOT FOUND OR v_menu.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR COALESCE(NEW.booking_kind, 'trial') <> 'trial'
     OR NOT public.menu_trial_open(NEW.menu_id) THEN
    RAISE EXCEPTION 'このメニューの体験予約は受け付けていません' USING ERRCODE = 'GB012';
  END IF;

  -- 担当はメニューで決まる（送ってきた値は使わない）
  NEW.staff_user_id := v_menu.staff_user_id;

  v_jst := NEW.booking_date AT TIME ZONE 'Asia/Tokyo';
  IF v_menu.starts_on IS NOT NULL AND v_jst::date < v_menu.starts_on THEN
    RAISE EXCEPTION 'このメニューの体験予約は受け付けていません' USING ERRCODE = 'GB012';
  END IF;

  -- 担当のシフト。数え方は guard_booking_staff_shift（GB002）と同じ:
  -- シフトを1行も持たない担当は営業時間どおり、持っていればその曜日の [開始, 終了) に始まること
  IF EXISTS (
    SELECT 1 FROM public.staff_schedules s
     WHERE s.tenant_id = NEW.tenant_id AND s.user_id = v_menu.staff_user_id
  ) THEN
    v_min := EXTRACT(HOUR FROM v_jst)::int * 60 + EXTRACT(MINUTE FROM v_jst)::int;
    SELECT EXISTS (
      SELECT 1 FROM public.staff_schedules s
       WHERE s.tenant_id = NEW.tenant_id
         AND s.user_id   = v_menu.staff_user_id
         AND s.weekday   = EXTRACT(DOW FROM v_jst)::int
         AND v_min >= (split_part(s.start_time, ':', 1)::int * 60 + split_part(s.start_time, ':', 2)::int)
         AND v_min <  (split_part(s.end_time,   ':', 1)::int * 60 + split_part(s.end_time,   ':', 2)::int)
    ) INTO v_ok;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'この担当者はその時間帯のシフトに入っていません' USING ERRCODE = 'GB002';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.apply_trial_menu() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS apply_trial_menu ON public.trial_bookings;
CREATE TRIGGER apply_trial_menu
  BEFORE INSERT ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.apply_trial_menu();

-- ── (4) 専用の時間: メニューの体験は担当の時間に入ってよい ─────────────────────────
-- 本番の定義（20261028030000）に、メニューの体験を先に通す1文を足しただけ。
CREATE OR REPLACE FUNCTION public.guard_trial_menu_reserved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_session_min integer;
  v_buffer_min  integer;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.menu_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT t.booking_buffer_minutes, t.slot_duration_minutes INTO v_buffer_min, v_session_min
    FROM public.tenants t WHERE t.id = NEW.tenant_id;
  IF public.menu_reserved_overlaps(
       NEW.tenant_id, NEW.booking_date, COALESCE(v_session_min, 60) + COALESCE(v_buffer_min, 15)) THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guard_trial_menu_reserved() FROM PUBLIC, anon, authenticated;

-- ── (5) 重なり: 体験の担当を数える・メニューの体験は時間ブロックを無視しない ────────────────
-- 本番の定義（20260914010000）に2か所を足しただけ:
--   - 体験の行の担当（staff_user_id）を返す（先生の体験と先生の予約の重なり＝GB001）
--   - 「体験だけ時間ブロックを無視する」設定は、メニューの体験には効かせない
--     （先生のお休みを時間ブロックで塞ぐため。トレーニングの体験向けの設定）
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
  blocked_count integer;
  staff_conflict_count integer;
  buffer_min integer;
  tenant_session_min integer;
  capacity_limit integer;
  new_session_min integer;
  new_option_min integer;
  new_footprint interval;
  new_staff uuid;
  -- 🔴 体験予約のときだけ true になりうる。既定 false（安全側）
  v_ignore_blocks boolean := false;
BEGIN
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  new_staff := (to_jsonb(NEW) ->> 'staff_user_id')::uuid;

  -- 🔴 trial_bookings にはこの列が無い。直接 NEW.option_minutes と書くと
  --    体験予約の登録が実行時に落ちる。
  new_option_min := GREATEST(COALESCE((to_jsonb(NEW) ->> 'option_minutes')::int, 0), 0);

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes
    INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = NEW.tenant_id;

  -- 🔴 ブロック枠を無視してよいのは「体験予約」だけ。
  --    TG_TABLE_NAME で bookings を必ず除く（この関数は2テーブル共用）。
  --    booking_kind でドロップインも除く（同じテーブルに同居している）。
  --    bookings には booking_kind 列が無いので to_jsonb で読む。
  IF TG_TABLE_NAME = 'trial_bookings'
     AND COALESCE(to_jsonb(NEW) ->> 'booking_kind', 'trial') = 'trial'
     AND (to_jsonb(NEW) ->> 'menu_id') IS NULL THEN
    SELECT COALESCE(t.trial_ignores_blocked_slots, false)
      INTO v_ignore_blocks
    FROM public.tenants t WHERE t.id = NEW.tenant_id;
    v_ignore_blocks := COALESCE(v_ignore_blocks, false);
  END IF;

  -- 🔴 同時受け入れ数は時間帯で変わりうる。帯が無ければ tenants.booking_capacity
  --    （テナントが取れない場合も含め、必ず 1 以上に倒る）。
  capacity_limit := public.resolve_booking_capacity(NEW.tenant_id, NEW.booking_date);

  SELECT tp.slot_duration_minutes INTO new_session_min
  FROM public.tenant_plans tp
  WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type
  LIMIT 1;
  new_session_min := COALESCE(new_session_min, tenant_session_min, 60);

  new_footprint := make_interval(mins => new_session_min + new_option_min + COALESCE(buffer_min, 15));
  new_start := NEW.booking_date;
  new_end := NEW.booking_date + new_footprint;

  SELECT
    COUNT(*) FILTER (WHERE existing.kind = 'block'),
    COUNT(*) FILTER (WHERE existing.kind = 'booking'),
    COUNT(*) FILTER (WHERE existing.kind = 'booking'
                       AND new_staff IS NOT NULL
                       AND existing.staff_user_id = new_staff)
  INTO blocked_count, overlap_count, staff_conflict_count
  FROM (
    SELECT 'booking' AS kind,
           b.booking_date AS start_at,
           b.booking_date + make_interval(mins =>
             COALESCE(tp.slot_duration_minutes, tenant_session_min, 60)
             + COALESCE(b.option_minutes, 0)
             + COALESCE(buffer_min, 15)
           ) AS end_at,
           b.staff_user_id
    FROM public.bookings b
    LEFT JOIN public.tenant_plans tp
      ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
    WHERE b.status != 'キャンセル済み'
      AND b.id IS DISTINCT FROM NEW.id
      AND b.tenant_id = NEW.tenant_id
      AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT 'booking' AS kind,
           tb.booking_date AS start_at,
           tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_at,
           tb.staff_user_id AS staff_user_id
    FROM public.trial_bookings tb
    WHERE tb.status != 'キャンセル済み'
      AND tb.id IS DISTINCT FROM NEW.id
      AND tb.tenant_id = NEW.tenant_id
      AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT 'block' AS kind,
           blocked_date AS start_at,
           end_blocked_date AS end_at,
           NULL::uuid AS staff_user_id
    FROM public.blocked_slots
    WHERE tenant_id = NEW.tenant_id
      AND (blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) AS existing
  WHERE new_start < existing.end_at
    AND existing.start_at < new_end;

  -- 文言は据え置き（capacity=1 のとき従来と完全に同じ挙動・同じメッセージになるように）。
  -- 🔴 v_ignore_blocks が true なのは「体験予約 × booking_kind='trial' ×
  --    メニューの体験でない × テナントが許可」の4つが揃ったときだけ。それ以外はここまでと同じ判定。
  IF (NOT v_ignore_blocks AND blocked_count > 0) OR overlap_count >= capacity_limit THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  IF staff_conflict_count > 0 THEN
    RAISE EXCEPTION 'この担当者はその時間帯にすでに予約が入っています'
      USING ERRCODE = 'GB001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── (6) 画面の埋まり枠: 体験の行にも担当を返す ───────────────────────────────────
-- 本番の定義（20261029020000）の、体験の行の staff_user_id を NULL から tb.staff_user_id にしただけ。
-- 会員の予約画面（担当のいるメニュー）は担当の重なりも見ている（src/lib/bookingOptionFit.ts）ので、
-- 同時受入数が2以上の店でも、先生の体験の時間に先生のメニューを出さない。
-- （予約の行は前から担当を返している。体験の担当もメニューの担当で、個人の情報ではない）
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
         tb.staff_user_id AS staff_user_id
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

-- ── (7) 公開ページ: メニューの体験の案内とシフト ─────────────────────────────────
-- 受け付けていないメニュー（menu_trial_open が false）は0行。担当の user_id は返さない。
CREATE OR REPLACE FUNCTION public.get_menu_trial_public(p_menu_id uuid)
RETURNS TABLE(
  menu_id uuid,
  tenant_id uuid,
  name text,
  starts_on date,
  trial_price_yen integer,
  trial_info_title text,
  trial_info_body text,
  shifts jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT m.id, m.tenant_id, m.name, m.starts_on, m.trial_price_yen, m.trial_info_title, m.trial_info_body,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('weekday', s.weekday, 'start_time', s.start_time, 'end_time', s.end_time)
                            ORDER BY s.weekday, s.start_time)
             FROM public.staff_schedules s
            WHERE s.tenant_id = m.tenant_id AND s.user_id = m.staff_user_id
         ), '[]'::jsonb)
    FROM public.booking_menus m
   WHERE m.id = p_menu_id
     AND public.menu_trial_open(m.id);
$fn$;
GRANT EXECUTE ON FUNCTION public.get_menu_trial_public(uuid) TO anon, authenticated;

-- ── (8) 公開ページ: メニューの体験の埋まり枠 ─────────────────────────────────────
-- get_tenant_booked_slots の最初の3つ（体験・予約・時間ブロック）と同じ行を返す。違いは2つ:
--   - 専用の時間（担当つきのブロック）を返さない。メニューの体験は担当の時間に入るので
--     （未ログインには担当つきのブロックと普通の時間ブロックの見分けがつかない＝こちらで分けて返す）
--   - 担当の user_id の代わりに「そのメニューの担当の予約か」（is_menu_staff）を返す
CREATE OR REPLACE FUNCTION public.get_menu_trial_slots(p_menu_id uuid, from_date date, to_date date)
RETURNS TABLE(
  booking_date timestamp with time zone,
  end_booking_date timestamp with time zone,
  status text,
  is_menu_staff boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- 名前を get_tenant_booked_slots の引数と同じにしてある（下の3つの SELECT を同じ文に保つため）
  p_tenant_id uuid;
  v_staff uuid;
  buffer_min integer;
  tenant_session_min integer;
BEGIN
  IF p_menu_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92
     OR NOT public.menu_trial_open(p_menu_id) THEN
    RETURN;
  END IF;

  SELECT m.tenant_id, m.staff_user_id INTO p_tenant_id, v_staff
    FROM public.booking_menus m WHERE m.id = p_menu_id;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes
    INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = p_tenant_id;

  RETURN QUERY
  SELECT tb.booking_date,
         tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_booking_date,
         tb.status,
         COALESCE(tb.staff_user_id = v_staff, false) AS is_menu_staff
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
         COALESCE(b.staff_user_id = v_staff, false) AS is_menu_staff
  FROM public.bookings b
  LEFT JOIN public.tenant_plans tp
    ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
  WHERE (b.tenant_id = p_tenant_id OR b.tenant_id IS NULL)
    AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT bs.blocked_date AS booking_date,
         bs.end_blocked_date AS end_booking_date,
         'ブロック済み' AS status,
         false AS is_menu_staff
  FROM public.blocked_slots bs
  WHERE (bs.tenant_id = p_tenant_id OR bs.tenant_id IS NULL)
    AND (bs.blocked_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.get_menu_trial_slots(uuid, date, date) TO anon, authenticated;
