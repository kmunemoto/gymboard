-- ============================================================================
-- インストラクター（制限付きスタッフ）（2026-10-28）
--
-- 宗本さん（パーソナルピラティスを始める。先生に来てもらう）:
--   「お店の設定とか触らせたくないので、お店にログインできるということだけにさせたい。
--    お知らせ・動画・設定は触らせないようにして、オーナーとは完全に分けてほしい。
--    お店側の画面で、お客さんの削除もできないようにしてほしい。これはオーナーだけができるように」
--
-- ## 何を足すか
--
-- tenant_members.staff_access（スタッフの権限）:
--   'full'    … 今まで通りのスタッフ（既定。既存の行もこれ）
--   'limited' … インストラクター。予約・顧客・メッセージ・種目は使えるが、店の運営は触れない
--
-- 判定は is_limited_staff(ジム, 人)。role = 'trainer' のときだけ効く（オーナー・お客様には関係ない）。
-- role は 'trainer' のまま。スタッフとしての今までの仕組み（担当・シフト・予定表・共有受信箱）を
-- そのまま使うため。新しい role を作ると、role を見ている数十か所を全部直すことになる。
--
-- ## インストラクターができないこと（DB でも断る。画面で隠すだけにしない）
--
--   お知らせ・動画の作成/変更/削除         announcements / announcement_audience / gym_videos
--   予約の設定                            booking_options / booking_option_customers / booking_questions /
--                                         booking_frequency_limits / booking_capacity_windows /
--                                         booking_blocked_windows / staff_schedules
--   その日の受付を止める・上限を外す       booking_closed_days / booking_uncapped_days
--   入金の記録                            member_payments
--   お客様の在籍・プランの変更（退会など） tenant_members の更新
--   お客様の契約の中身（プラン・猶予など） guard_profile_plan_fields（お客様本人と同じ扱い）
--   お客様の削除                          delete_customer_cascade
--   （店の設定 tenants・プラン tenant_plans は、もともとオーナーしか書けない）
--
-- 書けるかどうかは RESTRICTIVE のポリシーで足す（今あるポリシーは変えない）。
--
-- ## 🔴 スタッフ用の招待コードを、お客様から読めない場所へ移す
--
-- tenants.staff_invite_code は「オーナーだけが RPC で読む」つもりで列単位の REVOKE をしていたが、
-- authenticated に表全体の SELECT が付いているため **列の REVOKE が効いていなかった**
-- （2026-10-28 に本番で確認: ログインしたお客様が自分のジムのコードを読めた）。
-- お客様が別のアカウントを作ってそのコードで参加すると、スタッフとして全員の顧客情報が見える。
-- （確認時点でオーナー以外のスタッフはどのジムにも居ない＝使われた形跡は無い）
--
-- コードは tenant_staff_invites に移す。RLS を有効にしてポリシーを作らない＝関数からしか読めない。
-- tenants.staff_invite_code は常に NULL（CHECK で固定。誤ってまた入れないように）。
-- インストラクター用のコード（instructor_code）も同じ表に置く。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public）。
-- ============================================================================

-- ── (1) スタッフの権限 ──────────────────────────────────────────────────
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS staff_access text NOT NULL DEFAULT 'full';
ALTER TABLE public.tenant_members
  DROP CONSTRAINT IF EXISTS tenant_members_staff_access_check;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_staff_access_check CHECK (staff_access IN ('full', 'limited'));

COMMENT ON COLUMN public.tenant_members.staff_access IS
  'スタッフ（role=trainer）の権限。full=今まで通り / limited=インストラクター（店の運営は触れない・店宛ての通知の代表にならない）。変えられるのはオーナーだけ';

-- その人がそのジムのインストラクター（制限付きスタッフ）か。
-- RLS のポリシーから呼ぶので SECURITY DEFINER（tenant_members を読めない人の評価でも落ちない）。
-- 🔴 ポリシーは TO authenticated なので authenticated に EXECUTE が要る（外すと全画面が落ちる）。
CREATE OR REPLACE FUNCTION public.is_limited_staff(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = p_tenant_id
       AND m.user_id = p_user_id
       AND m.status = 'active'
       AND m.role = 'trainer'
       AND m.staff_access = 'limited'
  );
$fn$;
REVOKE ALL ON FUNCTION public.is_limited_staff(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_limited_staff(uuid, uuid) TO authenticated, service_role;

-- 権限を変えられるのはオーナーだけ（今まで通りのスタッフが自分や他人を変えられないように）。
-- 関数の中（参加の RPC など。current_user が authenticated ではない）からの変更は通す。
CREATE OR REPLACE FUNCTION public.guard_tenant_member_staff_access()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.staff_access IS DISTINCT FROM OLD.staff_access
     AND current_user = 'authenticated'
     AND NOT public.has_tenant_role(NEW.tenant_id, auth.uid(), ARRAY['owner']) THEN
    RAISE EXCEPTION 'スタッフの権限はオーナーだけが変更できます' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_guard_tenant_member_staff_access ON public.tenant_members;
CREATE TRIGGER trg_guard_tenant_member_staff_access
  BEFORE UPDATE OF staff_access ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_member_staff_access();

-- ── (2) インストラクターは店の運営を書き換えられない（RESTRICTIVE で足す） ─────────
DROP POLICY IF EXISTS limited_staff_no_insert ON public.announcements;
CREATE POLICY limited_staff_no_insert ON public.announcements AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.announcements;
CREATE POLICY limited_staff_no_update ON public.announcements AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.announcements;
CREATE POLICY limited_staff_no_delete ON public.announcements AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.announcement_audience;
CREATE POLICY limited_staff_no_insert ON public.announcement_audience AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.announcement_audience;
CREATE POLICY limited_staff_no_update ON public.announcement_audience AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.announcement_audience;
CREATE POLICY limited_staff_no_delete ON public.announcement_audience AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.gym_videos;
CREATE POLICY limited_staff_no_insert ON public.gym_videos AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.gym_videos;
CREATE POLICY limited_staff_no_update ON public.gym_videos AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.gym_videos;
CREATE POLICY limited_staff_no_delete ON public.gym_videos AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_options;
CREATE POLICY limited_staff_no_insert ON public.booking_options AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_options;
CREATE POLICY limited_staff_no_update ON public.booking_options AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_options;
CREATE POLICY limited_staff_no_delete ON public.booking_options AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_option_customers;
CREATE POLICY limited_staff_no_insert ON public.booking_option_customers AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_option_customers;
CREATE POLICY limited_staff_no_update ON public.booking_option_customers AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_option_customers;
CREATE POLICY limited_staff_no_delete ON public.booking_option_customers AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_questions;
CREATE POLICY limited_staff_no_insert ON public.booking_questions AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_questions;
CREATE POLICY limited_staff_no_update ON public.booking_questions AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_questions;
CREATE POLICY limited_staff_no_delete ON public.booking_questions AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_frequency_limits;
CREATE POLICY limited_staff_no_insert ON public.booking_frequency_limits AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_frequency_limits;
CREATE POLICY limited_staff_no_update ON public.booking_frequency_limits AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_frequency_limits;
CREATE POLICY limited_staff_no_delete ON public.booking_frequency_limits AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_capacity_windows;
CREATE POLICY limited_staff_no_insert ON public.booking_capacity_windows AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_capacity_windows;
CREATE POLICY limited_staff_no_update ON public.booking_capacity_windows AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_capacity_windows;
CREATE POLICY limited_staff_no_delete ON public.booking_capacity_windows AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_blocked_windows;
CREATE POLICY limited_staff_no_insert ON public.booking_blocked_windows AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_blocked_windows;
CREATE POLICY limited_staff_no_update ON public.booking_blocked_windows AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_blocked_windows;
CREATE POLICY limited_staff_no_delete ON public.booking_blocked_windows AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_closed_days;
CREATE POLICY limited_staff_no_insert ON public.booking_closed_days AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_closed_days;
CREATE POLICY limited_staff_no_update ON public.booking_closed_days AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_closed_days;
CREATE POLICY limited_staff_no_delete ON public.booking_closed_days AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.booking_uncapped_days;
CREATE POLICY limited_staff_no_insert ON public.booking_uncapped_days AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.booking_uncapped_days;
CREATE POLICY limited_staff_no_update ON public.booking_uncapped_days AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.booking_uncapped_days;
CREATE POLICY limited_staff_no_delete ON public.booking_uncapped_days AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.staff_schedules;
CREATE POLICY limited_staff_no_insert ON public.staff_schedules AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.staff_schedules;
CREATE POLICY limited_staff_no_update ON public.staff_schedules AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.staff_schedules;
CREATE POLICY limited_staff_no_delete ON public.staff_schedules AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

DROP POLICY IF EXISTS limited_staff_no_insert ON public.member_payments;
CREATE POLICY limited_staff_no_insert ON public.member_payments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.member_payments;
CREATE POLICY limited_staff_no_update ON public.member_payments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.member_payments;
CREATE POLICY limited_staff_no_delete ON public.member_payments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

-- 在籍・プランの変更（退会・休会・プラン）。インストラクターは自分の行も変えない
DROP POLICY IF EXISTS limited_staff_no_update ON public.tenant_members;
CREATE POLICY limited_staff_no_update ON public.tenant_members AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.tenant_members;
CREATE POLICY limited_staff_no_delete ON public.tenant_members AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

-- ── (3) お客様の削除はオーナー（と今まで通りのスタッフ）だけ ─────────────────────
-- 本番の定義（2026-10-28 の pg_get_functiondef）に、インストラクターを断る1か所を足しただけ。
CREATE OR REPLACE FUNCTION public.delete_customer_cascade(_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_can_act_for(_customer_id);

  -- 比較は IS DISTINCT FROM（<> だと未ログインで NULL になる書き方になる。rpcCallerCheck.test.ts）
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM _customer_id AND EXISTS (
    SELECT 1 FROM public.tenant_members me
      JOIN public.tenant_members target ON target.tenant_id = me.tenant_id
     WHERE me.user_id = auth.uid()
       AND me.status = 'active' AND me.role = 'trainer' AND me.staff_access = 'limited'
       AND target.user_id = _customer_id
  ) THEN
    RAISE EXCEPTION 'お客様の削除はオーナーだけができます' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.workouts WHERE user_id = _customer_id;
  DELETE FROM public.bookings WHERE user_id = _customer_id;
  DELETE FROM public.meals WHERE user_id = _customer_id;
  DELETE FROM public.messages WHERE sender_id = _customer_id OR receiver_id = _customer_id;
  DELETE FROM public.notification_settings WHERE user_id = _customer_id;
  DELETE FROM public.profiles WHERE user_id = _customer_id;
  DELETE FROM public.user_roles WHERE user_id = _customer_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.delete_customer_cascade(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_customer_cascade(uuid) TO authenticated;

-- ── (4) お客様の契約の中身: インストラクターはお客様本人と同じ扱い ──────────────────
-- 本番の定義（2026-10-28）から、冒頭の「本人以外（店）の変更は通す」をインストラクターでは通さない
-- ように変えただけ。以降の判定（プラン・猶予・固定は変えられない／起算日の初回設定は通す）は
-- お客様本人のときと同じ。予約を代わりに入れたときの起算日の自動設定（NULL→日付）は通る。
CREATE OR REPLACE FUNCTION public.guard_profile_plan_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_limited boolean;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  v_limited := v_actor IS DISTINCT FROM NEW.user_id AND EXISTS (
    SELECT 1 FROM public.tenant_members me
      JOIN public.tenant_members target ON target.tenant_id = me.tenant_id
     WHERE me.user_id = v_actor
       AND me.status = 'active' AND me.role = 'trainer' AND me.staff_access = 'limited'
       AND target.user_id = NEW.user_id
  );

  IF NOT v_limited THEN
    IF v_actor IS DISTINCT FROM NEW.user_id THEN
      RETURN NEW;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.user_id = v_actor AND tm.status = 'active'
         AND tm.role IN ('owner', 'trainer')
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 契約の中身は本人には変えさせない（cycle_start_pinned も店だけが操作できる）
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.grace_enabled IS DISTINCT FROM OLD.grace_enabled
     OR NEW.cycle_start_pinned IS DISTINCT FROM OLD.cycle_start_pinned THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  -- 起算日: NULL → 値の初回設定は許す。既に値がある行の変更は、
  --   (a) 店が起算日を固定しているお客様（cycle_start_pinned）… 常に拒否
  --   (b) 上限を強制しているプラン（allow_overflow=false）… 従来どおり拒否
  IF NEW.cycle_start_date IS DISTINCT FROM OLD.cycle_start_date
     AND OLD.cycle_start_date IS NOT NULL
     AND (
       OLD.cycle_start_pinned
       OR EXISTS (
         SELECT 1 FROM public.tenant_plans tp
          WHERE tp.plan_name = OLD.plan
            AND tp.allow_overflow = false
            AND tp.tenant_id IN (
              SELECT tm.tenant_id FROM public.tenant_members tm
               WHERE tm.user_id = OLD.user_id AND tm.status = 'active')
       )
     ) THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── (5) 招待コードを、お客様から読めない表へ移す ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_staff_invites (
  tenant_id       uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_code      text,
  instructor_code text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_staff_invites IS
  'スタッフ（staff_code）・インストラクター（instructor_code）として参加するための招待コード。関数からだけ読み書きする（ポリシーを作らない＝お客様もスタッフも直接は読めない）';

CREATE UNIQUE INDEX IF NOT EXISTS tenant_staff_invites_staff_code_key
  ON public.tenant_staff_invites (staff_code) WHERE staff_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_staff_invites_instructor_code_key
  ON public.tenant_staff_invites (instructor_code) WHERE instructor_code IS NOT NULL;

ALTER TABLE public.tenant_staff_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_staff_invites FROM anon, authenticated;

INSERT INTO public.tenant_staff_invites (tenant_id, staff_code)
SELECT t.id, t.staff_invite_code FROM public.tenants t WHERE t.staff_invite_code IS NOT NULL
ON CONFLICT (tenant_id) DO NOTHING;

UPDATE public.tenants SET staff_invite_code = NULL WHERE staff_invite_code IS NOT NULL;

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_staff_invite_code_unused;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_staff_invite_code_unused CHECK (staff_invite_code IS NULL);

COMMENT ON COLUMN public.tenants.staff_invite_code IS
  '使わない（常に NULL）。2026-10-28 に tenant_staff_invites へ移した（この列はログインしたお客様から読めたため）';

-- オーナーの招待コード（kind: staff / instructor）。初回は見に行ったときに発行する。
-- p_regenerate = true なら作り直す（古いコードは即座に使えなくなる）。
CREATE OR REPLACE FUNCTION public._owner_staff_invite_code(p_kind text, p_regenerate boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_code text;
BEGIN
  IF p_kind NOT IN ('staff', 'instructor') THEN
    RAISE EXCEPTION 'invalid_kind:%', p_kind USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL THEN
    IF p_regenerate THEN
      RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  SELECT t.id INTO v_tenant_id
    FROM public.tenants t
   WHERE t.owner_user_id = auth.uid()
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    IF p_regenerate THEN
      RAISE EXCEPTION 'この操作はジムのオーナーのみ行えます' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;  -- オーナーでなければ何も返さない
  END IF;

  IF NOT p_regenerate THEN
    SELECT CASE WHEN p_kind = 'instructor' THEN i.instructor_code ELSE i.staff_code END
      INTO v_code
      FROM public.tenant_staff_invites i
     WHERE i.tenant_id = v_tenant_id;
    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  v_code := public._gen_staff_invite_code();
  INSERT INTO public.tenant_staff_invites AS i (tenant_id, staff_code, instructor_code)
  VALUES (
    v_tenant_id,
    CASE WHEN p_kind = 'staff' THEN v_code END,
    CASE WHEN p_kind = 'instructor' THEN v_code END
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET staff_code      = CASE WHEN p_kind = 'staff' THEN EXCLUDED.staff_code ELSE i.staff_code END,
        instructor_code = CASE WHEN p_kind = 'instructor' THEN EXCLUDED.instructor_code ELSE i.instructor_code END,
        updated_at      = now();
  RETURN v_code;
END;
$fn$;
REVOKE ALL ON FUNCTION public._owner_staff_invite_code(text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_staff_invite_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT public._owner_staff_invite_code('staff', false);
$fn$;
GRANT EXECUTE ON FUNCTION public.get_my_staff_invite_code() TO authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_staff_invite_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT public._owner_staff_invite_code('staff', true);
$fn$;
GRANT EXECUTE ON FUNCTION public.regenerate_staff_invite_code() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_instructor_invite_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT public._owner_staff_invite_code('instructor', false);
$fn$;
REVOKE ALL ON FUNCTION public.get_my_instructor_invite_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_instructor_invite_code() TO authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_instructor_invite_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT public._owner_staff_invite_code('instructor', true);
$fn$;
REVOKE ALL ON FUNCTION public.regenerate_instructor_invite_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_instructor_invite_code() TO authenticated;

-- コードからジムを引く（参加前の確認画面用）。スタッフ用・インストラクター用どちらのコードでも引ける
CREATE OR REPLACE FUNCTION public.lookup_tenant_by_staff_invite_code(p_code text)
RETURNS TABLE(id uuid, gym_name text, address text, logo_url text, primary_color text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT t.id, t.gym_name, t.address, t.logo_url, t.primary_color
    FROM public.tenant_staff_invites i
    JOIN public.tenants t ON t.id = i.tenant_id
   WHERE lower(replace(trim(p_code), '-', '')) IN (i.staff_code, i.instructor_code)
     AND t.status IN ('active', 'trial')
   LIMIT 1;
$fn$;
REVOKE ALL ON FUNCTION public.lookup_tenant_by_staff_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_tenant_by_staff_invite_code(text) TO authenticated;

-- 参加する。インストラクター用のコードなら最初から制限付き（staff_access = 'limited'）。
-- 本番の定義（2026-10-28）から、コードの引き先と staff_access の2か所だけ変えた。
CREATE OR REPLACE FUNCTION public.join_tenant_as_staff_with_invite_code(p_code text, p_display_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
  v_name text;
  v_existing_role text;
  v_code text;
  v_access text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_name := nullif(btrim(coalesce(p_display_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'お名前を入力してください' USING ERRCODE = 'check_violation';
  END IF;

  v_code := lower(replace(btrim(coalesce(p_code, '')), '-', ''));
  SELECT i.tenant_id, CASE WHEN i.instructor_code = v_code THEN 'limited' ELSE 'full' END
    INTO v_tenant_id, v_access
    FROM public.tenant_staff_invites i
    JOIN public.tenants t ON t.id = i.tenant_id
   WHERE v_code <> ''
     AND v_code IN (i.staff_code, i.instructor_code)
     AND t.status IN ('active', 'trial')
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION '招待コードが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT tm.role INTO v_existing_role
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_tenant_id AND tm.user_id = v_uid;

  IF v_existing_role = 'owner' THEN
    RETURN v_tenant_id;
  ELSIF v_existing_role = 'customer' THEN
    RAISE EXCEPTION 'このアカウントはこのジムにお客様として登録されています。別のアカウントでお試しください'
      USING ERRCODE = 'check_violation';
  ELSIF v_existing_role = 'trainer' THEN
    UPDATE public.tenant_members
      SET status = 'active', display_name = v_name, staff_access = v_access
      WHERE tenant_id = v_tenant_id AND user_id = v_uid;
    RETURN v_tenant_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = v_uid AND tm.tenant_id <> v_tenant_id AND tm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'このアカウントは既に別のジムに参加しています'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.tenant_members (tenant_id, user_id, role, display_name, status, staff_access)
  VALUES (v_tenant_id, v_uid, 'trainer', v_name, 'active', v_access);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'trainer')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.profiles (user_id, display_name)
  VALUES (v_uid, v_name)
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  RETURN v_tenant_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.join_tenant_as_staff_with_invite_code(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_tenant_as_staff_with_invite_code(text, text) TO authenticated;
