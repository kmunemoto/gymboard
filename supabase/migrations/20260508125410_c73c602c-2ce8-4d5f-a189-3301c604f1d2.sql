
CREATE OR REPLACE FUNCTION public.recalculate_event_progress(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event record;
  v_user record;
  v_count int := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(), 'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_event FROM public.season_events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'イベントが見つかりません'; END IF;

  -- All users with any workout in the event window, plus existing participants
  FOR v_user IN
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM public.workouts
      WHERE workout_date BETWEEN v_event.start_date AND v_event.end_date
      UNION
      SELECT user_id FROM public.daily_missions
      WHERE mission_date BETWEEN v_event.start_date AND v_event.end_date
      UNION
      SELECT user_id FROM public.user_event_progress WHERE event_id = p_event_id
    ) u
  LOOP
    PERFORM public.update_event_progress(v_user.user_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('users_processed', v_count, 'event_id', p_event_id);
END;
$$;
