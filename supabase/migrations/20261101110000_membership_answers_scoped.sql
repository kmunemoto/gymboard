-- ============================================================================
-- 所属の判定と、ジムの人数・上限を、関係の無い人には答えないようにする（2026-11-01）
-- ============================================================================
-- 宗本さん「そのほかやって」。点検の拡大 membership-oracle-1・tenant-limit-status-1（どちらも low。反証役が「通る」と判断）。
--
-- ■ 何が起きていたか
-- 1. 所属の判定の関数（is_tenant_member・is_tenant_member_any_status・has_tenant_role・has_role）は、RLS のポリシーと
--    門番のトリガーが使うので、ログインした誰でも直接呼べる。引数の user_id・tenant_id を呼んだ人と突き合わせずに
--    答えるので、他人の user_id と公開されているジムの id（体験予約のページの URL など）を組にして呼ぶと、
--    その人がどのジムに在籍しているか・していたか（退会も含む）・お客様かスタッフかが分かった。
--    チャットを送ろうとしたときのエラーの違いからも同じことが分かった（門番のトリガーがこの関数で確かめてから断る）。
--    同じジムのお客様も、他のお客様の在籍・退会を確かめられた。
-- 2. get_tenant_limit_status は、どのジムの id を渡しても、お客様数・スタッフ数・上限（＝契約プラン）を返した。
--    is_tenant_over_limit は未ログインでも呼べた。
--
-- ■ 直し方
-- 1. 所属の判定は、呼んだ人が「本人」か「そのジムの在籍中のスタッフ」のとき、または聞かれた人が「そのジムの在籍中の
--    スタッフ」のときだけ本当の答えを返し、それ以外は false を返す（_may_see_membership）。
--    サーバー（service_role・cron。auth.uid() が無い）には今まで通り答える。
--    - 本番の全部のポリシー・関数の呼び方を数えて確かめた（2026-11-01）。ポリシーは auth.uid() を渡すか（本人）、
--      スタッフだけが通るもの（お知らせの宛先・限定オプションの対象）。門番のトリガーは、予約は本人かスタッフの代理、
--      チャットはスタッフ宛てかスタッフから。関数の中の呼び出しは auth.uid() を渡す。→ 正規の呼び方では答えは変わらない。
--    - has_tenant_role は、聞く役割がスタッフ（owner・trainer）だけのときは今まで通り（聞かれた人がスタッフなら元から
--      本当の答え、そうでなければ元から false で、答えが変わらない。ポリシーで1行ずつ呼ばれるので、余計な確かめを足さない）。
--      お客様の役割を聞くときだけ確かめる。
--    - is_limited_staff は「聞かれた人がインストラクターか」しか答えないので変えない（同じ理由）。
--    - has_role（ジムに関係しない印）は、本人とサーバーにだけ答える。
-- 2. get_tenant_limit_status は、そのジムに在籍している人にだけ返す（それ以外は NULL。画面は何も出さない）。
--    is_tenant_over_limit は anon から外す（呼び出し元の2つはどちらも SECURITY DEFINER なので影響しない）。
--
-- 🔴 関数は本番の定義（pg_get_functiondef・2026-11-01）を写して、答える条件だけを足した。
-- 見張り: src/test/membershipAnswersScoped.test.ts
-- ============================================================================

-- 本当の答えを返してよいか（呼んだ人が本人・そのジムの在籍中のスタッフ、または聞かれた人がそのジムの在籍中のスタッフ）
CREATE OR REPLACE FUNCTION public._may_see_membership(p_tenant_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_user_id = auth.uid() THEN true
    WHEN auth.uid() IS NULL THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.tenant_members s
       WHERE s.tenant_id = p_tenant_id
         AND s.user_id IN (auth.uid(), p_user_id)
         AND s.role IN ('owner', 'trainer')
         AND s.status = 'active'
    )
  END
$function$;

REVOKE ALL ON FUNCTION public._may_see_membership(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id uuid, _user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public._may_see_membership(_tenant_id, _user_id) THEN EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = _tenant_id
      AND user_id = _user_id
      AND status = 'active'
  ) ELSE false END
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_member_any_status(p_tenant_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL
     AND public._may_see_membership(p_tenant_id, p_user_id)
     AND EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = p_tenant_id
       AND m.user_id = p_user_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id uuid, _user_id uuid, _roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _roles <@ ARRAY['owner', 'trainer']::text[]
      OR public._may_see_membership(_tenant_id, _user_id)
    THEN EXISTS (
      SELECT 1 FROM public.tenant_members
      WHERE tenant_id = _tenant_id
        AND user_id = _user_id
        AND role = ANY(_roles)
        AND status = 'active'
    )
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id = auth.uid() OR auth.uid() IS NULL THEN EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
    )
    ELSE false
  END
$function$;

CREATE OR REPLACE FUNCTION public.get_tenant_limit_status(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_max_customers INTEGER;
  v_max_trainers INTEGER;
  v_customers INTEGER;
  v_trainers INTEGER;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- そのジムに在籍している人にだけ返す（サーバーは今まで通り）
  IF auth.uid() IS NOT NULL AND NOT public.is_tenant_member(p_tenant_id, auth.uid()) THEN
    RETURN NULL;
  END IF;
  SELECT max_customers, max_trainers
    INTO v_max_customers, v_max_trainers
  FROM public.tenants WHERE id = p_tenant_id;

  SELECT COUNT(*) INTO v_customers FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND role = 'customer' AND status <> 'cancelled';
  SELECT COUNT(*) INTO v_trainers FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND role = 'trainer' AND status <> 'cancelled';

  RETURN jsonb_build_object(
    'customer_count', v_customers,
    'trainer_count', v_trainers,
    'max_customers', v_max_customers,
    'max_trainers', v_max_trainers,
    'customer_over', (v_max_customers IS NOT NULL AND v_customers > v_max_customers),
    'trainer_over',  (v_max_trainers  IS NOT NULL AND v_trainers  > v_max_trainers),
    'over_limit', public.is_tenant_over_limit(p_tenant_id)
  );
END;
$function$;

-- 未ログインからは呼ばせない（呼び出し元の get_tenant_limit_status・enforce_tenant_plan_limit はどちらも SECURITY DEFINER）。
-- authenticated は 20260808030000 の取り決めどおり残す。
REVOKE EXECUTE ON FUNCTION public.is_tenant_over_limit(uuid) FROM PUBLIC, anon;
