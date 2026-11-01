-- ============================================================================
-- メッセージの取り消しと、インストラクターを外したあとの扱いを直す（2026-11-01・点検の拡大）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- ■ unsend-message-1（medium）: 未ログインで、他人のメッセージを取り消せた
-- unsend_message は「送り主が自分か」を `v_row.sender_id <> auth.uid()` で見ていた。anon キーだけで呼ぶと
-- auth.uid() が NULL になり、比較も NULL で IF が通らず、他人のメッセージ（24時間以内）の本文・添付が消えた
-- （相手の画面では送り主が取り消したように見える）。しかも anon が実行できた。
--   → `auth.uid() IS NULL OR v_row.sender_id IS DISTINCT FROM auth.uid()` に変え、anon から外す。
--     アプリはログインしたまま呼んでいるので、古い版にも影響しない。
--
-- ■ join-staff-rejoin-1（medium）: 外したインストラクターが、同じ招待リンクで戻れた
-- remove_staff_member は在籍の行を消すだけで、インストラクターの招待コードは変わらなかった。外された人が
-- 同じ /join-staff/<コード> を開くと、また limited の trainer として入り、お客様全員の氏名・予約・チャット・
-- 体の記録が見えた（別のアカウントでも、コードを人に渡しても同じ）。
--   → 外すときに、インストラクターの招待コードを作り直す（配布中で未使用のリンクも無効になる。画面の確認文で知らせる）。
--
-- 🔴 どちらも定義は本番の pg_get_functiondef（2026-11-01）から**機械的に写し**、1か所だけ変えてある。
--    unsend_message md5 1720504d365b91c9352cab66e3d41c84 / remove_staff_member md5 2858a581654c79aad10f492cc609eb89
--
-- 見張り: src/test/unsendAndStaffRemoval.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.unsend_message(_message_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row     public.messages%ROWTYPE;
  v_path    TEXT;
BEGIN
  SELECT * INTO v_row FROM public.messages WHERE id = _message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'message_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.uid() IS NULL OR v_row.sender_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_sender' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_row.unsent_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_row.created_at < now() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'too_old' USING ERRCODE = 'check_violation';
  END IF;

  v_path := v_row.attachment_path;

  UPDATE public.messages
     SET content         = '',
         attachment_path = NULL,
         attachment_type = NULL,
         sticker_id      = NULL,
         unsent_at       = now()
   WHERE id = _message_id;

  RETURN v_path;
END;
$function$;

REVOKE ALL ON FUNCTION public.unsend_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unsend_message(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.remove_staff_member(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
  v_target_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  WHERE t.owner_user_id = v_uid
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'この操作はジムのオーナーのみ行えます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id = v_uid THEN
    RAISE EXCEPTION '自分自身は削除できません' USING ERRCODE = 'check_violation';
  END IF;

  SELECT tm.role INTO v_target_role
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_tenant_id AND tm.user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION '対象のスタッフが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_target_role <> 'trainer' THEN
    RAISE EXCEPTION 'スタッフ以外は削除できません' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.bookings
    SET staff_user_id = NULL
    WHERE tenant_id = v_tenant_id AND staff_user_id = p_user_id;

  DELETE FROM public.tenant_members
    WHERE tenant_id = v_tenant_id AND user_id = p_user_id AND role = 'trainer';

  -- 外した人が同じ招待リンクで戻れないよう、インストラクターの招待コードを作り直す（2026-11-01 点検 join-staff-rejoin-1）
  UPDATE public.tenant_staff_invites
     SET instructor_code = public._gen_staff_invite_code(), updated_at = now()
   WHERE tenant_id = v_tenant_id AND instructor_code IS NOT NULL;
END;
$function$;
