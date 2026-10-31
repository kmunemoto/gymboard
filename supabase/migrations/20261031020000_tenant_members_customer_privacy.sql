-- ============================================================================
-- お客様が、同じジムの他のお客様のメンバー情報を読めないようにする（2026-10-31・穴10）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- 本番でお客様を演じて全テーブルを数えたところ、tenant_members だけが、同じジムの
-- **他のお客様全員の行**（名前・プラン・残り回数・更新日・休会/退会の日付と理由）を返していた。
-- ポリシー "Members can view same tenant members"（is_tenant_member だけ）が、
-- そのジムのメンバーなら誰にでも全行を見せていたため。画面には出していないが、
-- ログインしたお客様なら API（公開キー＋自分のログイン）で読める。
-- 別のジムからは読めない（テナントの境界は効いている）。お客様どうしの話。
--
-- 直し方: 同じジムの行を読めるのは
--   - スタッフ（オーナー・トレーナー・インストラクター）… 全員の行（今まで通り。顧客一覧などに要る）
--   - お客様 … スタッフの行だけ（予約・チャットで担当の名前を出すのに要る）
--     自分の行は別のポリシー "Users can view own membership" で読める（変えていない）
--
-- 確かめたこと:
--   - お客様の画面が他のお客様の行を読んでいる箇所は無い
--     （useAllCustomerProfiles 等はトレーナーの画面だけ。お客様側は自分の行かスタッフの行）
--   - この表を読む SECURITY INVOKER の関数は無い（SECURITY DEFINER は RLS を通らないので影響しない）
--   - Edge Function は service_role で読むので影響しない
-- 見張り: src/test/tenantMembersPrivacy.test.ts・security/check.sql の検査8
-- ============================================================================

DROP POLICY IF EXISTS "Members can view same tenant members" ON public.tenant_members;

DROP POLICY IF EXISTS "Customers see staff, staff see members" ON public.tenant_members;
CREATE POLICY "Customers see staff, staff see members" ON public.tenant_members
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_member(tenant_id, auth.uid())
    AND (
      role IN ('owner', 'trainer')
      OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
    )
  );
