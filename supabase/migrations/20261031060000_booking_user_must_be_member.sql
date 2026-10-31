-- ============================================================================
-- 予約は、そのジムに所属している人の分しか作れないようにする（2026-10-31・穴13）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- ■ 何が起きていたか
-- ジムは誰でも開ける（それは仕様）。自分で開いたジムのオーナーは、自分のジムの予約を作れる。
-- ところが予約の user_id が「そのジムの人か」を、どこも確かめていなかった。
-- 他のジムの人の user_id を入れて予約を作ると、予約の通知（notify-new-booking → send-transactional-email、
-- どちらも service_role）が、その人の氏名を読み、その人のメールアドレスへ「予約確認」を送る。
--   - 送った記録（email_send_log）には宛先のアドレスと氏名が残り、ジムのスタッフは読める
--     → user_id さえ分かれば、他のジムの人の**メールアドレスと氏名が抜ける**
--   - 差出人名・案内文は攻撃者のジムの設定なので、正規のドメインからのなりすましメールにもなる
-- 他のジムのオーナー・先生の user_id は公開の情報（空き枠の担当・ロゴのファイル名）から取れる。
--
-- ■ 直し方
-- bookings の BEFORE INSERT / UPDATE OF user_id, tenant_id で、画面から（authenticated）の書き込みは
-- 「user_id がそのジムに所属している（在籍の状態は問わない）」を必須にする。
--   - お客様本人の予約・スタッフの代理予約は、どちらも所属している人なので変わらない
--   - 本番の959件のうち所属していない人の予約は、古い4件だけ（直近90日は0件）。既存の行は触らない
--   - 予約を作る DB 関数は無く、Edge Function も予約を作らない（service_role は対象外にしてある）
-- 🔴 門番の関数は SECURITY INVOKER（current_user で「画面から」を見分ける。DEFINER にすると素通り）。
--
-- 見張り: src/test/bookingUserMembership.test.ts・security/check.sql の検査12
-- ============================================================================

-- そのジムに所属しているか（在籍の状態は問わない。休会・退会の人の過去の予約の付け替えなどで困らないように）
CREATE OR REPLACE FUNCTION public.is_tenant_member_any_status(p_tenant_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = p_tenant_id
       AND m.user_id = p_user_id
  );
$$;

-- トリガーは呼んだ人の権限で動くので、authenticated に EXECUTE が要る
REVOKE ALL ON FUNCTION public.is_tenant_member_any_status(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_member_any_status(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_booking_user_is_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NOT public.is_tenant_member_any_status(NEW.tenant_id, NEW.user_id) THEN
    RAISE EXCEPTION 'このジムに所属していない方の予約は作れません' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_booking_user_is_member ON public.bookings;
CREATE TRIGGER trg_guard_booking_user_is_member
  BEFORE INSERT OR UPDATE OF user_id, tenant_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_user_is_member();
