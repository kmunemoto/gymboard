-- ============================================================================
-- 同じジムの他のお客様の在籍・お知らせの宛先・限定オプションの対象を、お客様が RPC で確かめられないようにする（2026-11-11）
-- ============================================================================
-- 宗本さん「全部直すで」（2026-11-10 の定期点検）。指摘 shares_tenant_with_me-1（low）。
--
-- ■ 何が起きていたか
-- 穴30（20261101110000_membership_answers_scoped.sql）で、所属の判定の関数（is_tenant_member など）は「本人・サーバー・
-- そのジムの在籍中のスタッフ」にだけ本当の答えを返すようにした。次の3つは対象から漏れていて、ログインした誰でも
-- RPC で直接呼べ、聞かれた人と呼んだ人の関係を見ずに答えた:
--   1. shares_tenant_with_me(_target_user_id) … その人が自分のジムに在籍中か（お客様が他のお客様の在籍・退会を確かめられた）
--   2. announcement_audience_has(p_announcement_id, p_user_id) … その人がお知らせの「個別」の宛先か・「全員から除く」で
--      除かれたか（未払いの人だけに送ったお知らせなら、その人が未払いだと分かる）
--   3. booking_option_allowed(p_option_id, p_user_id) … その人が限定オプションの対象か
--
-- ■ 直し方
-- 本番の定義（pg_get_functiondef・2026-11-11）を写して、答える条件だけを足す。本当の答えを返すのは:
--   - 聞かれた人が呼んだ本人（ポリシーは auth.uid() を渡すので、ここで終わる）
--   - サーバー（service_role・cron。auth.uid() が無い）
--   - 呼んだ人がそのジムの在籍中のスタッフ（shares_tenant_with_me は聞かれた人がスタッフのときも。_may_see_membership と同じ）
-- それ以外は false。
-- 本番で呼んでいるのはポリシーだけ（関数・トリガーからの呼び出しは0件）:
--   - shares_tenant_with_me … profiles・skeletal_diagnoses・weight_journey・announcement_reads の RESTRICTIVE
--     （「本人 OR shares_tenant_with_me」。お客様は PERMISSIVE 側で元から本人の行しか読めない）と、置き場（写真）のスタッフの枝
--   - announcement_audience_has・booking_option_allowed … auth.uid() を渡す（本人）
-- → 正規の呼び方では答えが変わらない。お客様・オーナー・インストラクターが読む件数が前後で同じことを、本番の同じ
--   トランザクションで比べてから適用した（mem/ops/tenant-boundary.md の穴35）。
-- EXECUTE は剥がさない（RLS が使う。剥がすと読めなくなる）。
--
-- 見張り: src/test/membershipAnswersScoped.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.shares_tenant_with_me(_target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.user_id = _target_user_id
      AND tm.status = 'active'
      AND tm.tenant_id = public.get_my_tenant_id()
  )
  AND public._may_see_membership(public.get_my_tenant_id(), _target_user_id)
$function$;

CREATE OR REPLACE FUNCTION public.announcement_audience_has(p_announcement_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.announcement_audience x
     WHERE x.announcement_id = p_announcement_id AND x.user_id = p_user_id
  )
  AND (
    p_user_id = auth.uid()
    OR auth.uid() IS NULL
    OR EXISTS (
      SELECT 1 FROM public.announcements a
       WHERE a.id = p_announcement_id
         AND public.has_tenant_role(a.tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.booking_option_allowed(p_option_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.booking_option_customers c
     WHERE c.option_id = p_option_id AND c.user_id = p_user_id
  )
  AND (
    p_user_id = auth.uid()
    OR auth.uid() IS NULL
    OR EXISTS (
      SELECT 1 FROM public.booking_options o
       WHERE o.id = p_option_id
         AND public.has_tenant_role(o.tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
    )
  );
$function$;
