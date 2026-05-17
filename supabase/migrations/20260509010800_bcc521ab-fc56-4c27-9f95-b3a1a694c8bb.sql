CREATE OR REPLACE FUNCTION public.get_quest_progress(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_progress record;
  v_values jsonb;
  v_stages jsonb;
  v_completed jsonb;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
  IF v_user <> auth.uid() AND NOT has_role(auth.uid(),'trainer'::app_role) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user;
  IF NOT FOUND THEN
    INSERT INTO public.user_quest_progress (user_id) VALUES (v_user)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user;
  END IF;

  v_values := public._quest_condition_values(v_user);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'stage_number', s.stage_number,
      'name', s.name,
      'name_before', s.name_before,
      'description', s.description,
      'story_intro', s.story_intro,
      'story_complete', s.story_complete,
      'theme_gradient_from', s.theme_gradient_from,
      'theme_gradient_to', s.theme_gradient_to,
      'theme_dark_from', s.theme_dark_from,
      'theme_dark_to', s.theme_dark_to,
      'theme_icon', s.theme_icon,
      'reward_coins', s.reward_coins,
      'reward_exp', s.reward_exp,
      'reward_title', s.reward_title,
      'reward_badge_key', s.reward_badge_key,
      'reward_frame', s.reward_frame,
      'background_image_url', s.background_image_url,
      'conditions', (
        SELECT jsonb_agg(jsonb_build_object(
          'condition_type', c.condition_type,
          'target_value', c.target_value,
          'display_label', c.display_label,
          'sort_order', c.sort_order,
          'current_value', COALESCE((v_values->>c.condition_type)::numeric, 0)
        ) ORDER BY c.sort_order)
        FROM public.quest_stage_conditions c WHERE c.stage_id = s.id
      )
    ) ORDER BY s.stage_number
  ) INTO v_stages
  FROM public.quest_stages s;

  SELECT COALESCE(jsonb_agg(stage_id ORDER BY stage_id), '[]'::jsonb) INTO v_completed
  FROM public.user_quest_stage_completions WHERE user_id = v_user;

  RETURN jsonb_build_object(
    'current_stage', v_progress.current_stage,
    'stages', COALESCE(v_stages, '[]'::jsonb),
    'condition_values', v_values,
    'completed_stage_ids', v_completed
  );
END;
$function$;