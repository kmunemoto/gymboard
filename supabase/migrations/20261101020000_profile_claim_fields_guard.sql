-- ============================================================================
-- お客様の「取り込み・招待・本人が来た」の印を、画面（API）から書き換えられないようにする（2026-11-01）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。点検の拡大
-- invite-customer-1 / profiles-claimed-at-1（反証役がどれも「通る」と判断）。
--
-- ■ 何が起きていたか
-- CSV で取り込んだお客様には profiles.imported_at が付き、本人がログインすると claimed_at が付く。
-- invite-customer（招待メール）は「imported_at があり、claimed_at が無い」お客様のメールを差し替えて
-- パスワード設定リンクを送る。ところが claimed_at はオーナーが API で消せた（profiles の UPDATE ポリシーは
-- スタッフに全列を許し、列を見る門番は無い）。
--   → オーナーが claimed_at を消して招待し直すと、本人が使っているアカウントのメールが攻撃者のアドレスになり、
--     リンクからパスワードを設定して**お客様のアカウントを乗っ取れた**（本人は締め出される。そのアカウントで
--     他のジムにも入っていれば、そのジムの記録・チャットにも届く）。
--
-- ■ 直し方
-- 1. （このマイグレーション）BEFORE UPDATE の門番で、画面から（current_user が authenticated / anon）の
--    imported_at・claimed_at・invited_at の**変更**を拒む（同じ値なら通す）。書くのは次の3つだけで、どれも対象外:
--      - import_customers（SECURITY DEFINER）… imported_at
--      - claim_my_profile（SECURITY DEFINER）… claimed_at（アプリは RPC を呼ぶだけで、列を直接書かない）
--      - invite-customer（service_role）… invited_at
-- 2. （Edge Function）invite-customer は、auth 側で一度でもログインした・Google/Apple がつながったアカウントを
--    触らない（profiles の列に頼らない）。
-- 🔴 門番の関数は SECURITY INVOKER（current_user で「画面から」を見分ける。DEFINER にすると素通り）。
--
-- 見張り: src/test/inviteCustomerClaim.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_profile_claim_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.imported_at IS DISTINCT FROM OLD.imported_at
  OR NEW.claimed_at  IS DISTINCT FROM OLD.claimed_at
  OR NEW.invited_at  IS DISTINCT FROM OLD.invited_at THEN
    RAISE EXCEPTION '取り込み・招待の記録は、この画面からは変えられません' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_claim_fields ON public.profiles;
CREATE TRIGGER trg_guard_profile_claim_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_claim_fields();
