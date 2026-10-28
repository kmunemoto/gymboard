-- ============================================================================
-- 予約の記録（booking_notify_log）に、その時点の予約の担当（staff_user_id）を残す（2026-10-28）
-- ============================================================================
-- 宗本さん:「お客様→代表の1人+先生、もしくは、お客様→代表の1人。これを考えて使い分けて」
--
-- 出回っている古いアプリは、キャンセルを「店のスタッフ全員」（先生を含む）にプッシュし、
-- 店宛てのメールを先生に送る（代表を「スタッフ優先」で選ぶため）。先生の担当の予約なら
-- 「代表＋先生」、そうでなければ「代表だけ」にサーバー側で振り分けたいが、キャンセルは予約の行を
-- 消すので、通知が届いた時点では「誰の担当だったか」が分からない。消える前の担当をここに残す。
--
-- 読むのは send-push-notification（キャンセルのプッシュ）と send-transactional-email（キャンセルの
-- 店宛てメール）。どちらも、列が無い・行が無いときは今まで通り送る（届かないより、届くほうがまし）。
--
-- トリガー関数3本は本番の定義（pg_get_functiondef・2026-10-28）に staff_user_id を足しただけ。
-- ============================================================================

ALTER TABLE public.booking_notify_log
  ADD COLUMN IF NOT EXISTS staff_user_id uuid;

COMMENT ON COLUMN public.booking_notify_log.staff_user_id IS
  'その時点の予約の担当（bookings.staff_user_id）。キャンセルで消えた予約の担当をサーバーが引くため'
  '（古いアプリのキャンセルの通知を「代表＋先生」か「代表だけ」に振り分ける・2026-10-28）';

-- キャンセルのプッシュはタグ（お客様＋予約日時）から引く
CREATE INDEX IF NOT EXISTS idx_booking_notify_log_user_date
  ON public.booking_notify_log (user_id, booking_date);

CREATE OR REPLACE FUNCTION public.notify_booking_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_log_id UUID;
  v_skip   TEXT;
  v_base   TEXT;
  v_key    TEXT;
  v_req    BIGINT;
BEGIN
  IF NEW.status IS DISTINCT FROM '予約済み' THEN
    v_skip := 'not_active';
  ELSIF NEW.created_via = 'reschedule' THEN
    v_skip := 'reschedule';
  ELSIF NEW.tenant_id IS NULL THEN
    v_skip := 'no_tenant';
  END IF;
  INSERT INTO public.booking_notify_log
    (booking_id, tenant_id, user_id, actor_user_id, event, booking_date, booking_type, skip_reason, staff_user_id)
  VALUES
    (NEW.id, NEW.tenant_id, NEW.user_id, auth.uid(), 'created', NEW.booking_date, NEW.booking_type, v_skip, NEW.staff_user_id)
  RETURNING id INTO v_log_id;
  IF v_skip IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'project_functions_url' LIMIT 1;
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  IF v_base IS NULL OR v_key IS NULL THEN
    UPDATE public.booking_notify_log SET skip_reason = 'vault_secret_missing' WHERE id = v_log_id;
    RAISE LOG 'notify_booking_created: vault secret missing. skipped booking %', NEW.id;
    RETURN NEW;
  END IF;
  SELECT net.http_post(
    url     := v_base || '/notify-new-booking',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_key),
    body    := jsonb_build_object('booking_id', NEW.id, 'log_id', v_log_id)
  ) INTO v_req;
  UPDATE public.booking_notify_log SET http_request_id = v_req WHERE id = v_log_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_booking_created failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_booking_removed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.booking_notify_log
    (booking_id, tenant_id, user_id, actor_user_id, event, booking_date, booking_type, staff_user_id)
  VALUES
    (OLD.id, OLD.tenant_id, OLD.user_id, auth.uid(), 'removed', OLD.booking_date, OLD.booking_type, OLD.staff_user_id);
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'log_booking_removed failed for booking %: %', OLD.id, SQLERRM;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_booking_forfeited()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.booking_notify_log
    (booking_id, tenant_id, user_id, actor_user_id, event, booking_date, booking_type, staff_user_id)
  VALUES
    (NEW.id, NEW.tenant_id, NEW.user_id, auth.uid(), 'forfeited', NEW.booking_date, NEW.booking_type, NEW.staff_user_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'log_booking_forfeited failed for booking %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_booking_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_booking_removed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_booking_forfeited() FROM PUBLIC, anon, authenticated;
