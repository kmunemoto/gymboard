-- ============================================================================
-- オーナーを引き継いでも、ジムの持ち主（tenants.owner_user_id）が元のオーナーのままだった穴を塞ぐ（2026-11-01）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。点検の拡大
-- transfer-gym-ownership-1（反証役が「通る」と判断）。
--
-- ■ 何が起きていたか
-- transfer_gym_ownership は tenant_members の役割（新オーナー=owner、元オーナー=インストラクター）と user_roles しか
-- 変えず、tenants.owner_user_id は元のオーナーのままだった。owner_user_id で「オーナーか」を見ている所が多いので、
--   - 元オーナー: ジムの設定（店名・案内文・お客様の招待コードなど）の更新、インストラクターの招待コードの取得、
--     インストラクターを外す、が続けてできた。新オーナーはどれもできず、画面から元オーナーを外せない
--   - 新オーナーが API で元オーナーの所属を消しても、元オーナーは tenant_members の INSERT ポリシーの
--     「owner_user_id が自分のジムなら owner として入れる」で、フル権限のオーナーとして戻れた（全お客様の情報が見える）
--   - 元オーナーがアカウントを消そうとすると、tenants_owner_user_id_fkey で失敗した（引き継ぎの目的が果たせない）
-- 本番で引き継ぎは0件（今は潜在。次に引き継ぎが起きた時点で成立する）。
--
-- ■ 直し方（本番の pg_get_functiondef から写し、1行足しただけ）
-- 役割を入れ替えたあと、tenants.owner_user_id も新オーナーにする。SECURITY DEFINER の中なので、tenants の門番
-- （guard_tenant_billing_columns。current_user が authenticated / anon のときだけ見る）は通る。
-- 引数も戻り値も変わらないので、古いアプリはそのまま動く。
--
-- 見張り: src/test/transferGymOwnership.test.ts
-- ============================================================================

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
  -- ジムの持ち主も新オーナーにする（2026-11-01）。🔴 これが無いと、元オーナーが設定を変え続けられ、
  --    外されても owner として入れ直せた（tenant_members の INSERT ポリシーは owner_user_id を見る）。
  UPDATE public.tenants SET owner_user_id = _to_user_id WHERE id = v_tenant_id;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_to_user_id, 'trainer'::app_role) ON CONFLICT DO NOTHING;
END; $function$;
