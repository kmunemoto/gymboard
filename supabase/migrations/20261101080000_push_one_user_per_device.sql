-- ============================================================================
-- 共用の端末で、ログアウトした人・前に使った人宛てのプッシュ通知が出続けた穴を（サーバー側で）塞ぐ（2026-11-01）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。点検の拡大 push-logout-1。
--
-- ■ 何が起きていたか
-- 通知の宛先は push_devices（ネイティブの FCM トークン）・push_subscriptions（Web の購読）に「人 × 端末」で入っている。
-- ログアウトしても行は消えず、同じ端末で別の人がログインすると同じトークンでもう1行増える。受付のタブレット・家族の端末・
-- 受付の PC で、前の人宛ての通知（お客様の名前・予約日時・チャットの冒頭）が出続け、そこにいる誰でも読めた。
-- 本番（2026-11-01）: 2つの端末で、オーナーとお客様のアカウントが同じトークンに登録されていた。
--
-- ■ 直し方（このマイグレーション＝古いアプリにも効く分）
-- 同じトークン・同じ購読先を別の人が登録したら、前の人の行を消す（その端末には最後にログインした人の通知だけが届く）。
-- アプリは起動のたびにこの端末のトークンを登録し直す（PushBootstrap）ので、次に開いた時点で整う。
-- ログアウトだけして誰も入らない場合は、画面の側（ログアウトの前にこの端末の行を消す。src/lib/pushNotifications.ts の
-- forgetThisDeviceForPush）で消す。Web は Publish で、ネイティブは次のビルドで届く。
-- 🔴 関数は SECURITY DEFINER（他人の行を消すので、RLS を越える必要がある）。画面からは呼べない（トリガー専用）。
--
-- 見張り: src/test/pushLogout.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.push_devices_one_user_per_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.push_devices
   WHERE fcm_token = NEW.fcm_token
     AND user_id IS DISTINCT FROM NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.push_devices_one_user_per_token() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_devices_one_user_per_token ON public.push_devices;
CREATE TRIGGER trg_push_devices_one_user_per_token
  BEFORE INSERT OR UPDATE OF fcm_token, user_id ON public.push_devices
  FOR EACH ROW EXECUTE FUNCTION public.push_devices_one_user_per_token();

CREATE OR REPLACE FUNCTION public.push_subscriptions_one_user_per_endpoint()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.push_subscriptions
   WHERE endpoint = NEW.endpoint
     AND user_id IS DISTINCT FROM NEW.user_id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.push_subscriptions_one_user_per_endpoint() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_subscriptions_one_user_per_endpoint ON public.push_subscriptions;
CREATE TRIGGER trg_push_subscriptions_one_user_per_endpoint
  BEFORE INSERT OR UPDATE OF endpoint, user_id ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.push_subscriptions_one_user_per_endpoint();
