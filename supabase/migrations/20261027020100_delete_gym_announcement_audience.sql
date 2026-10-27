-- 閉店時に「お知らせの配信対象で選んだお客様」も消す（2026-10-27）
--
-- announcement_audience を足した（20261027020000）ので、delete_my_gym の
-- 消し込み対象に加える（外部キーの ON DELETE CASCADE でも消えるが、全テーブルを
-- 明示的に消す、がこの関数の決まり）。
--
-- 🔴 定義は本番の pg_get_functiondef（2026-10-27 時点）から**機械的に写し**、
--    announcement_audience の1行だけを announcement_reads の直後（announcements より前）に足してある。
--    古い版から書き直すと、その間に増えたテーブルの消し込みが黙って消える。
--    見張り: src/test/gymOwnership.test.ts「テナント配下のテーブルを取りこぼしていない」

CREATE OR REPLACE FUNCTION public.delete_my_gym()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_tenant_id UUID;
  v_others    INT;
  v_owned     INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*), (array_agg(tenant_id))[1] INTO v_owned, v_tenant_id
    FROM public.tenant_members
   WHERE user_id = v_uid AND role = 'owner' AND status = 'active';

  IF v_owned = 0 THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_owned > 1 THEN
    RAISE EXCEPTION 'ambiguous_tenant:%', v_owned USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_others
    FROM public.tenant_members
   WHERE tenant_id = v_tenant_id
     AND user_id <> v_uid
     AND status = 'active';

  IF v_others > 0 THEN
    RAISE EXCEPTION 'members_remain:%', v_others USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.announcement_reads
   WHERE announcement_id IN (SELECT id FROM public.announcements WHERE tenant_id = v_tenant_id);
  DELETE FROM public.announcement_audience WHERE tenant_id = v_tenant_id;

  DELETE FROM public.member_agreements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_reactions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.messages            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_templates   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.gym_videos          WHERE tenant_id = v_tenant_id;
  DELETE FROM public.operator_feedback   WHERE tenant_id = v_tenant_id;

  DELETE FROM public.workouts            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercise_id_map     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercises           WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_muscle_groups WHERE tenant_id = v_tenant_id;

  DELETE FROM public.booking_waitlist    WHERE tenant_id = v_tenant_id;
  DELETE FROM public.bookings            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_notify_log  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.email_send_log     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.blocked_slots       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.trial_bookings      WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_questions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.staff_schedules     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_frequency_limits WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_capacity_windows WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_blocked_windows WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_closed_days  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_uncapped_days WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_option_customers WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_options      WHERE tenant_id = v_tenant_id;

  DELETE FROM public.member_payments     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.counseling_responses WHERE tenant_id = v_tenant_id;
  DELETE FROM public.monthly_reports     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.progress_photos     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.user_measurements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.meals               WHERE tenant_id = v_tenant_id;
  DELETE FROM public.notification_settings WHERE tenant_id = v_tenant_id;
  DELETE FROM public.announcements       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.migration_user_map  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_plans        WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenant_members      WHERE tenant_id = v_tenant_id;

  UPDATE public.profiles SET tenant_id = NULL WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenants WHERE id = v_tenant_id;
END;
$function$;
