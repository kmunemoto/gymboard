-- ============================================================================
-- ジムの連絡先リンクに javascript: を入れられた穴・自分の LINE ID を書き換えて公式 LINE から誰にでも送れた穴を塞ぐ（2026-11-01）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。点検の拡大
-- tenant-contact-url-1 / line-link-1（どちらも low。反証役が「通る」と判断）。
--
-- ■ 何が起きていたか
-- 1. ジムの「LINEで連絡」「Google口コミ」の URL（tenants.line_url / google_review_url）は、画面でしか http(s) を
--    確かめていなかった。オーナーが API で javascript:… を入れると、ボタンを押したお客様の画面（アプリの中）で
--    スクリプトが動き、そのお客様のセッションを盗める（そのお客様が通う他のジムの情報にも届く）。
-- 2. 自分の profiles.line_user_id を任意の LINE ID に書き換えてから send-line-message を「自分宛て」で呼ぶと、
--    全ジム共通の公式アカウントから、好きな LINE ユーザーに任意の文面を送れた（生の line_user_id を service_role
--    だけにした制限が外れる）。スタッフも、お客様の line_user_id を書き換えられた。
--
-- ■ 直し方
-- 1. tenants の line_url・google_review_url・website_url に CHECK（NULL・空・http(s) だけ）。本番の既存の行は全部これに
--    収まる（2026-11-01 に数えた）。画面の保存は空なら NULL にするので、正規の保存は落ちない。
--    画面側も openExternalUrl の入口で http(s) 以外を開かない（src/lib/nativeBridge.ts。Web は Publish・ネイティブは次のビルド）。
-- 2. profiles の line_user_id は、画面から（current_user が authenticated / anon）は NULL にする（連携の解除）ことしか
--    できない。値を入れるのは line-login-callback（service_role）だけ。🔴 関数は SECURITY INVOKER（current_user で
--    「画面から」を見分ける。DEFINER にすると素通り）。
--
-- 見張り: src/test/contactUrlAndLineIdGuard.test.ts
-- ============================================================================

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_line_url_http;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_line_url_http
  CHECK (line_url IS NULL OR line_url = '' OR line_url ~* '^https?://') NOT VALID;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_line_url_http;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_google_review_url_http;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_google_review_url_http
  CHECK (google_review_url IS NULL OR google_review_url = '' OR google_review_url ~* '^https?://') NOT VALID;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_google_review_url_http;

ALTER TABLE public.tenants DROP CONSTRAINT IF EXISTS tenants_website_url_http;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_website_url_http
  CHECK (website_url IS NULL OR website_url = '' OR website_url ~* '^https?://') NOT VALID;
ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_website_url_http;

CREATE OR REPLACE FUNCTION public.guard_profile_line_user_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.line_user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.line_user_id IS DISTINCT FROM OLD.line_user_id) THEN
    RAISE EXCEPTION 'LINE の連携は、連携の画面からだけ行えます' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_line_user_id ON public.profiles;
CREATE TRIGGER trg_guard_profile_line_user_id
  BEFORE INSERT OR UPDATE OF line_user_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_line_user_id();
