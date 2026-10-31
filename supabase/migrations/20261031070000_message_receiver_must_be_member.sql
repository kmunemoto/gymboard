-- ============================================================================
-- チャットは、そのジムの人にしか送れないようにする（2026-10-31・穴13 の続き）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- ■ 何が起きていたか
-- messages の INSERT は「送り主が自分」と「自分のジムの行」しか見ていなかった。receiver_id は何でも入る。
-- 送ると AFTER INSERT のトリガーが notify-new-message（service_role）を呼び、宛先へプッシュ通知を中継する。
--   - 他のジムの人の user_id を宛先にすると、その人の端末に「〇〇さんからメッセージ」と本文が届く
--     （表示名は自分で変えられるので、ジムや決済を名乗れる。チャット画面には出ず通知だけ届く）
--   - 同じジムのお客様どうしでも送れた（画面には無い使い方）
-- 他のジムのオーナーの user_id は公開の情報（ロゴのファイル名）から取れる。
--
-- ■ 直し方（20261031060000 の予約と同じ形）
-- 画面から（authenticated）の書き込みは:
--   1. 宛先がそのジムに所属している（在籍の状態は問わない。退会したお客様へのスタッフからの連絡は今まで通り）
--   2. 送り主がそのジムのスタッフでなければ（＝お客様）、宛先はそのジムのスタッフ
-- 本番の223件のうち、1・2 に当てはまらないのは古い8件だけ（直近90日は0件）。既存の行は触らない。
-- メッセージを作る DB 関数は無い。service_role（Edge Function）は対象外。
-- 🔴 門番の関数は SECURITY INVOKER（current_user で「画面から」を見分ける）。
--
-- 見張り: src/test/bookingUserMembership.test.ts・security/check.sql の検査12
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_message_receiver_is_member()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    IF NOT public.is_tenant_member_any_status(NEW.tenant_id, NEW.receiver_id) THEN
      RAISE EXCEPTION 'このジムに所属していない方には送れません' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_tenant_role(NEW.tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
       AND NOT public.has_tenant_role(NEW.tenant_id, NEW.receiver_id, ARRAY['owner', 'trainer']) THEN
      RAISE EXCEPTION 'メッセージはジムのスタッフにだけ送れます' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_message_receiver_is_member ON public.messages;
CREATE TRIGGER trg_guard_message_receiver_is_member
  BEFORE INSERT OR UPDATE OF receiver_id, tenant_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_receiver_is_member();
