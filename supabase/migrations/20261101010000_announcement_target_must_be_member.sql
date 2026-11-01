-- ============================================================================
-- お知らせの「1人宛て」は、そのジムの人にしか出せないようにする（2026-11-01・点検の拡大 push-announcements-1）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- ■ 何が起きていたか（high・反証役4体がどれも「通る」と判断）
-- announcements.target には 'all' / 'except' / 'only' のほか、古いアプリが書く「1人宛て」（user_id）が入る。
-- 表への直接の INSERT / UPDATE は「自分のジムの行」しか見ておらず、target は何でも入った。
-- push-announcements はそれを service_role で send-push-notification に渡す（service_role は宛先の所属を見ない）。
--   → 誰でも開けるジムのオーナーが、target に**他のジムの人の user_id** を入れると、その人の端末に
--     公式アプリから「お知らせ: <好きな題名>」と本文が届いた（他のジムや運営を騙ったフィッシング）。
--     push_sent_at を NULL に戻せば何度でも、件数の制限も無かった。
-- 本番の4件はどれも全員・除く・個別（1人宛ては0件）。悪用の跡は無い。
--
-- ■ 直し方（穴13 の予約・チャットと同じ形）
-- 画面から（authenticated / anon）の INSERT と、target / tenant_id を変える UPDATE では、
-- target が 'all' / 'except' / 'only' / NULL 以外なら「uuid の形で、かつそのジムに所属している人
-- （在籍の状態は問わない）」でなければ拒む。古いアプリが書くのは自分のジムのお客様の user_id だけなので、そのまま動く。
-- push-announcements の push_sent_at の書き込み（service_role）は対象外。題名・本文だけの編集では動かない。
-- 送る側（push-announcements）でも、1人宛て・個別の宛先をそのジムの人に絞る（Edge Function・多層防御）。
-- 🔴 門番の関数は SECURITY INVOKER（current_user で「画面から」を見分ける。DEFINER にすると素通り）。
--
-- 見張り: src/test/announcementTargetGuard.test.ts・security/check.sql の検査12
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_announcement_target()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_target uuid;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  -- 題名・本文だけの編集では見ない（宛先がもうジムを抜けた古い1人宛ての行も、編集はそのまま続けられる）
  IF TG_OP = 'UPDATE'
     AND NEW.target IS NOT DISTINCT FROM OLD.target
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  IF NEW.target IS NULL OR NEW.target IN ('all', 'except', 'only') THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_target := NEW.target::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'お知らせの宛先が正しくありません' USING ERRCODE = '22023';
  END;

  IF NOT public.is_tenant_member_any_status(NEW.tenant_id, v_target) THEN
    RAISE EXCEPTION 'このジムに所属していない方には送れません' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_announcement_target ON public.announcements;
CREATE TRIGGER trg_guard_announcement_target
  BEFORE INSERT OR UPDATE OF target, tenant_id ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.guard_announcement_target();
