-- ============================================================================
-- 予約メニュー（booking_menus）。2026-10-28
-- ============================================================================
--
-- 宗本さん（パーソナルピラティスを始める。ピラティスの先生に来てもらう）:
--   「お客様用にも、筋トレの予約とピラティスの予約で分けて予約できるようにしてほしい」
--   「お客さんは、ヨガかマシンピラティスのどっちかを選べる」
-- 確認して決めたこと:
--   1. ピラティスの時間（先生のシフト）は、ひとまずピラティス専用。先着順にも変えられる
--      （tenants.menu_staff_hours_exclusive。既定 true＝専用）
--   2. 回数は今のプランから1回として数える（プランは変えない。お客様は同じ料金で両方受けられる）
--   3. 1日の上限は曜日ごとの上限をそのまま使う（メニューで分けない）
--   4. 時間は同じ（プランの長さのまま）
--   5. 体験予約はトレーニングだけ（体験はメニューを持たない）
--   メニューの名前に「パーソナル」は付けない（お客様は分かっている）
--
-- ## 形
--
--   booking_menus(tenant_id, name, staff_user_id, is_active, sort_order)
--   bookings.menu_id
--
--   - 担当（staff_user_id）のいるメニューの予約は、その担当の予約になる（apply_booking_menu）。
--     その担当のシフト（staff_schedules）の時間だけ取れる（シフト外は今まで通り GB002）
--   - 担当のいないメニュー（トレーニング）は今まで通り
--   - メニューを送ってこない予約（古いアプリ・メニューを選ばない代理予約）は、担当のいない
--     先頭のメニューとして記録する（担当を選んだ予約には付けない）
--
-- ## 🔴 担当のいるメニューの時間は、そのメニュー専用（menu_staff_hours_exclusive）
--
--   担当のシフトの時間に、担当のいない予約（トレーニング）・体験・ドロップインを入れない。
--   - 重なりは「開始＋1枠＋オプション＋間」と、シフトの [開始, 終了) で見る
--     （check_booking_overlap と同じ占有。間を入れないと、直前のトレーニングの間が
--      ピラティスの最初の枠を潰す）
--   - 止めるのは**お客様ご自身の予約**（auth.uid() = user_id）と体験・ドロップインだけ。
--     店の代理予約は通す（先生のお休みの日にトレーニングを入れる、など店の裁量）
--   - 担当のいるメニューの担当の予約（ヨガ・ピラティス）は止めない。
--     担当が2人いて時間が重なっても、互いの予約を止めない
--   - 🔴 シフトを1行も持たない担当（＝営業時間どおり）は専用の時間を持たない。
--     持たせると営業時間がまるごと専用になり、トレーニングが1枠も取れなくなる
--   - 画面には get_tenant_booked_slots が「担当つきのブロック」（status='ブロック済み'、
--     staff_user_id あり）として返す。公開の体験ページも同じ RPC を見ているので、
--     体験の枠からも自動で消える（ブロックとして扱われる）
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public）。メニューは本番で直接作る。
-- ============================================================================

-- ── (1) 表 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_menus (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- お客様に見える名前。「トレーニング」「ヨガ」「マシンピラティス」など
  name          text NOT NULL,
  -- 担当。いれば、このメニューの予約はこの人の予約になり、この人のシフトの時間だけ取れる
  staff_user_id uuid,
  -- お客様に出すか。予約に使われたメニューは消せない（下の外部キー）ので、やめるときはこれを外す
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- 空白だけの名前を許すと、予約画面に押せるだけの空のボタンが出る
  CONSTRAINT booking_menus_name_check CHECK (btrim(name) <> '' AND char_length(name) <= 30)
);

COMMENT ON TABLE public.booking_menus IS
  '予約メニュー（例: トレーニング / ヨガ / マシンピラティス）。staff_user_id があれば、その担当の予約になり'
  'その担当のシフトの時間だけ取れる。tenants.menu_staff_hours_exclusive が true なら、その時間は担当の'
  'いない予約・体験を受けない（お客様ご自身の予約だけ。代理予約は通す）。回数・料金・時間はプランのまま';

CREATE INDEX IF NOT EXISTS idx_booking_menus_tenant ON public.booking_menus (tenant_id);

ALTER TABLE public.booking_menus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.booking_menus;
CREATE POLICY tenant_isolation ON public.booking_menus AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 読みは同じジムの人全員（お客様の予約画面がメニューを出すのに要る）
DROP POLICY IF EXISTS booking_menus_select ON public.booking_menus;
CREATE POLICY booking_menus_select ON public.booking_menus
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS booking_menus_insert ON public.booking_menus;
CREATE POLICY booking_menus_insert ON public.booking_menus
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_menus_update ON public.booking_menus;
CREATE POLICY booking_menus_update ON public.booking_menus
  FOR UPDATE TO authenticated
  USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_menus_delete ON public.booking_menus;
CREATE POLICY booking_menus_delete ON public.booking_menus
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

-- インストラクター（制限付きスタッフ）はメニューを変えられない（店の設定。20261028020000 と同じ形）
DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_menus;
CREATE POLICY limited_staff_no_insert ON public.booking_menus AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_menus;
CREATE POLICY limited_staff_no_update ON public.booking_menus AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_menus;
CREATE POLICY limited_staff_no_delete ON public.booking_menus AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

-- 表そのものは anon に開けない（公開ページはメニューを出さない。専用の時間は RPC がブロックとして返す）
REVOKE ALL ON public.booking_menus FROM anon;

CREATE OR REPLACE FUNCTION public.touch_booking_menus()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_booking_menus ON public.booking_menus;
CREATE TRIGGER trg_touch_booking_menus
  BEFORE UPDATE ON public.booking_menus
  FOR EACH ROW EXECUTE FUNCTION public.touch_booking_menus();

-- ── (2) 予約・店の設定 ─────────────────────────────────────────────────────
-- 🔴 外部キーは ON DELETE の動作を付けない（＝予約に使われたメニューは消せない）。
--    SET NULL にすると、メニューを消すたびに過去の予約へ UPDATE が走り、bookings の
--    UPDATE トリガー（回数・受付停止・ゲーム要素など）を全部くぐることになる。
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS menu_id uuid REFERENCES public.booking_menus(id);
CREATE INDEX IF NOT EXISTS idx_bookings_menu_id ON public.bookings (menu_id) WHERE menu_id IS NOT NULL;

COMMENT ON COLUMN public.bookings.menu_id IS
  '予約メニュー（booking_menus）。NULL はメニューを使っていない店の予約・メニュー導入前の予約・担当を選んだ古いアプリの予約';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS menu_staff_hours_exclusive boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.menu_staff_hours_exclusive IS
  '担当のいる予約メニューの担当のシフトの時間を、そのメニュー専用にするか。true=専用（担当のいない予約・体験を受けない）/ false=先着順';

-- ── (3) 専用の時間に重なるか ───────────────────────────────────────────────
-- [p_start, p_start + p_minutes) が、担当のいるメニュー（有効）の担当のシフトに重なるか。
-- 専用にしていない店（menu_staff_hours_exclusive = false）では常に false。
-- 担当はジムの現役のスタッフに限る（外したスタッフのシフトが残っていても専用にしない）。
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

-- ── (4) 予約にメニューを当てる・専用の時間を守る ───────────────────────────────
-- 🔴 トリガー名は BEFORE トリガーの中でいちばん先に動く名前にする（名前の順に動く）。
--    担当を埋めてから、担当の検証（guard_booking_staff_assignment）・シフト（GB002）・
--    担当の重なり（check_booking_overlap の GB001）が見る。
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

DROP TRIGGER IF EXISTS apply_booking_menu ON public.bookings;
CREATE TRIGGER apply_booking_menu
  BEFORE INSERT OR UPDATE OF menu_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.apply_booking_menu();

-- 体験・ドロップインも専用の時間には入れない（トレーニングの予約なので）。
-- 文言は満枠と同じにする（trial-book / drop-in-book は「この時間帯」で満枠の案内に振り分ける）。
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

DROP TRIGGER IF EXISTS trg_guard_trial_menu_reserved ON public.trial_bookings;
CREATE TRIGGER trg_guard_trial_menu_reserved
  BEFORE INSERT ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_trial_menu_reserved();

-- ── (5) 画面が見る埋まり枠に、専用の時間を「担当つきのブロック」として足す ─────────────
-- 本番の定義（20260903000000）に、最後の UNION ALL を1つ足しただけ。
--   - お客様の予約画面: 担当のいるメニュー（その担当の予約）では、このブロックを無視する
--     （src/lib/bookingOptionFit.ts）。担当のいないメニューでは普通のブロック
--   - 公開の体験ページ・古いアプリ: 普通のブロック（体験は入れない・古いアプリでは選べない）
--   - 担当の user_id は未ログイン（公開ページ）には返さない（使わないので）
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
    )
    AND EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = p_tenant_id AND tm.user_id = s.user_id
         AND tm.status = 'active' AND tm.role IN ('owner', 'trainer')
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_booked_slots(uuid, date, date) TO anon, authenticated;
