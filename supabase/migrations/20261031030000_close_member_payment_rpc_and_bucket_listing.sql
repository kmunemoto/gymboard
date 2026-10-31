-- ============================================================================
-- 外から呼ぶ必要のない関数と、公開の置き場の「一覧」を閉じる（2026-10-31・セキュリティ点検）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- 1. member_first_unpaid_cycle_start(tenant, user)
--    会員の「入金がまだのサイクルの始まり」を返す関数。**ログインしていなくても、他人の user_id を渡して
--    呼べた**（security/check.sql 検査5-b の ★★）。誰が未払いかを調べられる。
--    呼んでいるのは SECURITY DEFINER の2本だけ（get_my_next_cycle_payment_gate・
--    guard_booking_next_cycle_payment）。どちらも所有者の権限で動くので、外からの EXECUTE を外しても困らない。
--    RLS のポリシーでも使っていない（使っていると、外した瞬間にそのテーブルが読めなくなる。穴8の教訓）。
--
-- 2. 公開の置き場（avatars・gym-assets）の一覧
--    公開の置き場のファイルは URL で読める（RLS を通らない）ので、SELECT のポリシーが効くのは
--    「一覧」と「ログインしての読み出し」だけ。誰でも一覧できると、ファイル名に入っている
--    オーナーの user_id・ジムの id を拾われる（本番では avatars にオーナーの id 入りのロゴが並んでいた）。
--    - avatars … アップロードした本人だけ（オンボーディングのロゴ。upsert に SELECT が要る）
--    - gym-assets … そのジムのスタッフだけ、自分のジムのフォルダだけ（ロゴを消すときに一覧する）
--    画面はどちらも getPublicUrl（公開 URL）で表示しているので、表示は変わらない。
-- ============================================================================

REVOKE ALL ON FUNCTION public.member_first_unpaid_cycle_start(uuid, uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Avatar owners can list own files" ON storage.objects;
CREATE POLICY "Avatar owners can list own files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());

DROP POLICY IF EXISTS "Anyone can view gym assets" ON storage.objects;
DROP POLICY IF EXISTS "Gym staff can list own gym assets" ON storage.objects;
CREATE POLICY "Gym staff can list own gym assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'gym-assets'
    AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
    AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
  );
