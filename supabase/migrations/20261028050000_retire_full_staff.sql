-- ============================================================================
-- 「スタッフ」（今まで通りのスタッフ＝staff_access = 'full' の trainer）をなくす（2026-10-28）
-- ============================================================================
-- 宗本さん「スタッフいらない」→ 全部のジムで。ジム側の人はオーナーとインストラクター（制限付き）だけにする。
-- 2026-10-28 時点で、どのジムにも trainer の行は1つも無い（スタッフもインストラクターもいない）。
--
-- 1. スタッフ用の招待コードを捨て、二度と作らない（スクリーンショット等で見えたコードで参加できないように）
-- 2. 照会・参加の RPC はインストラクター用のコードだけ受け付ける（参加した人は必ず limited）
-- 3. trainer は必ず limited（CHECK）。古いアプリから full に戻すこともできない
-- 4. オーナーのスタッフ用コードの RPC: 取得は NULL（古いアプリは画面ごと出さない）、作り直しは断る
--
-- 関数は本番の定義（pg_get_functiondef・2026-10-28）から、スタッフ用のコードの扱いだけを変えた。
-- ============================================================================

-- (1) スタッフ用の招待コードを捨てる。列は残す（古い関数・古いアプリの呼び出しで落とさない）が、常に NULL
UPDATE public.tenant_staff_invites SET staff_code = NULL, updated_at = now() WHERE staff_code IS NOT NULL;

ALTER TABLE public.tenant_staff_invites
  DROP CONSTRAINT IF EXISTS tenant_staff_invites_no_staff_code;
ALTER TABLE public.tenant_staff_invites
  ADD CONSTRAINT tenant_staff_invites_no_staff_code CHECK (staff_code IS NULL);

COMMENT ON COLUMN public.tenant_staff_invites.staff_code IS
  '使わない（常に NULL）。2026-10-28 に「スタッフ」をなくした。参加はインストラクター用のコード（instructor_code）だけ';

-- (3) trainer は必ずインストラクター（limited）
ALTER TABLE public.tenant_members
  DROP CONSTRAINT IF EXISTS tenant_members_trainer_is_instructor;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_trainer_is_instructor CHECK (role <> 'trainer' OR staff_access = 'limited');

COMMENT ON COLUMN public.tenant_members.staff_access IS
  'trainer は必ず limited（インストラクター。2026-10-28 に「スタッフ」＝full の trainer をなくした・CHECK tenant_members_trainer_is_instructor）。'
  'オーナー・お客様の値には意味が無い（既定の full のまま）';

-- (4) オーナーの招待コード。スタッフ用（kind = staff）は出さない・作らない
CREATE OR REPLACE FUNCTION public._owner_staff_invite_code(p_kind text, p_regenerate boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_code text;
BEGIN
  IF p_kind NOT IN ('staff', 'instructor') THEN
    RAISE EXCEPTION 'invalid_kind:%', p_kind USING ERRCODE = '22023';
  END IF;

  -- 「スタッフ」は 2026-10-28 になくした。取得は NULL（古いアプリはスタッフの画面ごと出さない）、作り直しは断る
  IF p_kind = 'staff' THEN
    IF p_regenerate THEN
      RAISE EXCEPTION 'スタッフの招待は終了しました。インストラクターとして招待してください' USING ERRCODE = 'feature_not_supported';
    END IF;
    RETURN NULL;
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
    SELECT i.instructor_code
      INTO v_code
      FROM public.tenant_staff_invites i
     WHERE i.tenant_id = v_tenant_id;
    IF v_code IS NOT NULL THEN
      RETURN v_code;
    END IF;
  END IF;

  v_code := public._gen_staff_invite_code();
  INSERT INTO public.tenant_staff_invites AS i (tenant_id, staff_code, instructor_code)
  VALUES (v_tenant_id, NULL, v_code)
  ON CONFLICT (tenant_id) DO UPDATE
    SET instructor_code = EXCLUDED.instructor_code,
        updated_at      = now();
  RETURN v_code;
END;
$function$;
REVOKE ALL ON FUNCTION public._owner_staff_invite_code(text, boolean) FROM PUBLIC, anon, authenticated;

-- (2) コードからジムを引く（参加前の確認画面用）。インストラクター用のコードだけ
CREATE OR REPLACE FUNCTION public.lookup_tenant_by_staff_invite_code(p_code text)
 RETURNS TABLE(id uuid, gym_name text, address text, logo_url text, primary_color text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.gym_name, t.address, t.logo_url, t.primary_color
    FROM public.tenant_staff_invites i
    JOIN public.tenants t ON t.id = i.tenant_id
   WHERE lower(replace(trim(p_code), '-', '')) = i.instructor_code
     AND t.status IN ('active', 'trial')
   LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.lookup_tenant_by_staff_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_tenant_by_staff_invite_code(text) TO authenticated;

-- (2) 参加する。インストラクター用のコードだけ。参加した人（参加し直しも）は必ず limited
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
  v_access text := 'limited';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_name := nullif(btrim(coalesce(p_display_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'お名前を入力してください' USING ERRCODE = 'check_violation';
  END IF;

  v_code := lower(replace(btrim(coalesce(p_code, '')), '-', ''));
  SELECT i.tenant_id
    INTO v_tenant_id
    FROM public.tenant_staff_invites i
    JOIN public.tenants t ON t.id = i.tenant_id
   WHERE v_code <> ''
     AND v_code = i.instructor_code
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

-- (5) オーナーの引き継ぎ。引き継ぎ先はインストラクター（trainer は全員 limited）なので:
--     - 新オーナーの limited を外す（staff_access = 'full'）。外さないと、店宛ての通知の宛先
--       （`.neq("staff_access", "limited")` で読む Edge Function・src/lib/staffAccess.ts の notifiableStaff）
--       からオーナーが漏れる
--     - 元オーナーはインストラクター（limited）になる（CHECK tenant_members_trainer_is_instructor）
--     本番の定義（2026-10-28）から、2つの UPDATE に staff_access を足しただけ。
CREATE OR REPLACE FUNCTION public.transfer_gym_ownership(_to_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid(); v_tenant_id UUID;
  v_target public.tenant_members%ROWTYPE; v_owned INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='insufficient_privilege'; END IF;

  SELECT count(*), (array_agg(tenant_id))[1] INTO v_owned, v_tenant_id
    FROM public.tenant_members
   WHERE user_id = v_uid AND role = 'owner' AND status = 'active';

  IF v_owned = 0 THEN RAISE EXCEPTION 'not_owner' USING ERRCODE='insufficient_privilege'; END IF;
  IF v_owned > 1 THEN RAISE EXCEPTION 'ambiguous_tenant:%', v_owned USING ERRCODE='check_violation'; END IF;
  IF _to_user_id = v_uid THEN RAISE EXCEPTION 'same_user' USING ERRCODE='check_violation'; END IF;

  SELECT * INTO v_target FROM public.tenant_members
   WHERE tenant_id = v_tenant_id AND user_id = _to_user_id
     AND role = 'trainer' AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'target_not_staff' USING ERRCODE='check_violation'; END IF;

  PERFORM set_config('app.owner_transfer', '1', true);

  UPDATE public.tenant_members SET role='owner', staff_access='full'
   WHERE tenant_id = v_tenant_id AND user_id = _to_user_id;
  UPDATE public.tenant_members SET role='trainer', staff_access='limited'
   WHERE tenant_id = v_tenant_id AND user_id = v_uid;

  PERFORM set_config('app.owner_transfer', '', true);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_to_user_id, 'trainer'::app_role) ON CONFLICT DO NOTHING;
END; $function$;
