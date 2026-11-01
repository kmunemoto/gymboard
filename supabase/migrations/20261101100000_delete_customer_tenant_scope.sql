-- ============================================================================
-- お客様の削除（delete_customer_cascade）が、他のジムの記録まで消していた穴を塞ぐ（2026-11-01）
-- ============================================================================
-- 宗本さん「そのほかやって」。点検の拡大 delete-customer-cascade-1（low。反証役が「通る」と判断）。
--
-- ■ 何が起きていたか
-- オーナーが顧客一覧からお客様を削除すると、そのお客様の記録（トレーニング・予約・食事・チャット）を user_id だけで
-- 探して、**全部のジムの分**消していた。ジムをまたいで1つしかないプロフィール・通知の設定・印（user_roles）も消していた。
-- 1. 他のジムから移ってきたインストラクターを API で「削除」すると、前のジムに残っていたチャットが消えた。
-- 2. 昔のお客様の所属の行（退会済み）を自分で「在籍」に戻してから削除すると、いま他のジムで働いている人の
--    チャット・プロフィール・印が消え、その人はそのジムのスタッフ画面に入れなくなった（参加し直しても戻らない）。
-- 3. 2つのジムに通うお客様を片方のオーナーが削除すると、もう片方のジムの記録とプロフィールまで消えた
--    （もう片方のジムに過去の予約があると、トリガーで全体が失敗して、削除そのものができなかった）。
--
-- ■ 直し方（引数・呼び方は同じ。古いアプリもそのまま動く）
-- - オーナーが呼んだとき: 消すのは「自分がオーナーとして在籍していて、そのお客様の所属の行がある」ジムの記録だけ
--   （tenant_id で絞る）。
--   - そのお客様に他のジムの所属の行（状態を問わない。退会済みも、在籍に戻せるので数える）が**無い**とき:
--     今まで通り、プロフィール・通知の設定・印も消す。tenant_id の無い古い行も消す（本番は0件）。
--     2026-11-01 の本番では、2つ以上のジムに所属の行がある人は0人なので、今の削除はすべてこちら＝今までと同じ結果。
--   - 他のジムにも所属の行が**ある**とき: 共通の行（プロフィール・通知の設定・印）は残し、
--     自分のジムのお客様としての所属の行を外す（顧客一覧から消える）。
-- - お客様本人・サーバー（service_role）が呼んだときは今まで通り全部消す（本人の退会）。
-- - インストラクター（limited）は今まで通り断る。
--
-- 🔴 関数は本番の定義（pg_get_functiondef・2026-11-01）を写して、消す範囲だけを変えた。
-- 見張り: src/test/deleteCustomerTenantScope.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_customer_cascade(_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenants uuid[];
  v_only_here boolean;
BEGIN
  PERFORM public.assert_can_act_for(_customer_id);

  -- 比較は IS DISTINCT FROM（<> だと未ログインで NULL になる書き方になる。rpcCallerCheck.test.ts）
  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM _customer_id AND EXISTS (
    SELECT 1 FROM public.tenant_members me
      JOIN public.tenant_members target ON target.tenant_id = me.tenant_id
     WHERE me.user_id = v_uid
       AND me.status = 'active' AND me.role = 'trainer' AND me.staff_access = 'limited'
       AND target.user_id = _customer_id
  ) THEN
    RAISE EXCEPTION 'お客様の削除はオーナーだけができます' USING ERRCODE = '42501';
  END IF;

  -- お客様本人（退会）・サーバー（service_role）: 今まで通り全部
  IF v_uid IS NULL OR v_uid = _customer_id THEN
    DELETE FROM public.workouts WHERE user_id = _customer_id;
    DELETE FROM public.bookings WHERE user_id = _customer_id;
    DELETE FROM public.meals WHERE user_id = _customer_id;
    DELETE FROM public.messages WHERE sender_id = _customer_id OR receiver_id = _customer_id;
    DELETE FROM public.notification_settings WHERE user_id = _customer_id;
    DELETE FROM public.profiles WHERE user_id = _customer_id;
    DELETE FROM public.user_roles WHERE user_id = _customer_id;
    RETURN;
  END IF;

  -- オーナー: 自分がオーナーとして在籍していて、そのお客様の所属の行がある（状態を問わない）ジムの分だけ
  SELECT array_agg(DISTINCT me.tenant_id) INTO v_tenants
    FROM public.tenant_members me
    JOIN public.tenant_members target
      ON target.tenant_id = me.tenant_id AND target.user_id = _customer_id
   WHERE me.user_id = v_uid AND me.status = 'active' AND me.role = 'owner';

  IF v_tenants IS NULL THEN
    RAISE EXCEPTION 'お客様の削除はオーナーだけができます' USING ERRCODE = '42501';
  END IF;

  -- 他のジムの所属の行（状態を問わない。退会済みの行も、オーナーが在籍に戻せるので数える）
  v_only_here := NOT EXISTS (
    SELECT 1 FROM public.tenant_members o
     WHERE o.user_id = _customer_id AND NOT (o.tenant_id = ANY (v_tenants))
  );

  DELETE FROM public.workouts
   WHERE user_id = _customer_id
     AND (tenant_id = ANY (v_tenants) OR (v_only_here AND tenant_id IS NULL));
  DELETE FROM public.bookings
   WHERE user_id = _customer_id
     AND (tenant_id = ANY (v_tenants) OR (v_only_here AND tenant_id IS NULL));
  DELETE FROM public.meals
   WHERE user_id = _customer_id
     AND (tenant_id = ANY (v_tenants) OR (v_only_here AND tenant_id IS NULL));
  DELETE FROM public.messages
   WHERE (sender_id = _customer_id OR receiver_id = _customer_id)
     AND (tenant_id = ANY (v_tenants) OR (v_only_here AND tenant_id IS NULL));

  IF v_only_here THEN
    DELETE FROM public.notification_settings WHERE user_id = _customer_id;
    DELETE FROM public.profiles WHERE user_id = _customer_id;
    DELETE FROM public.user_roles WHERE user_id = _customer_id;
  ELSE
    -- 他のジムにも所属がある: 共通の行は残し、このジムのお客様としての所属を外す
    DELETE FROM public.tenant_members
     WHERE user_id = _customer_id AND tenant_id = ANY (v_tenants) AND role = 'customer';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.delete_customer_cascade(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_customer_cascade(uuid) TO authenticated;
