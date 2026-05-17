
-- Update process_session_rewards: grant active companion EXP = floor(total_exp / 2)
CREATE OR REPLACE FUNCTION public.process_session_rewards(_user_id uuid, _workout_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gender text;
  v_volume numeric;
  v_today_count integer;
  v_today_sum integer;
  v_yesterday_exists boolean;
  v_combo_streak integer;
  v_mult numeric;
  v_combo_bonus integer;
  v_total_exp integer;
  v_coins integer;
  v_session_id uuid;
  v_avatar_lvl_before integer;
  v_avatar_lvl_after integer;
  v_avatar_total_exp_before integer;
  v_rank_before text;
  v_rank_after text;
  v_rank_bonus_coins integer := 0;
  v_rank_bonus_tickets integer := 0;
  v_rank_up boolean := false;
  v_volume_bonus integer;
  v_pr_count integer;
  v_pr_exercises jsonb;
  v_session_base integer;
  v_th20 numeric; v_th40 numeric; v_th60 numeric; v_th80 numeric; v_th100 numeric;
  v_comp record;
  v_comp_exp_gain int := 0;
  v_comp_new_exp int;
  v_comp_new_level int;
  v_comp_name text := NULL;
  v_comp_evolved boolean := false;
  v_evo_def record;
BEGIN
  INSERT INTO public.user_avatars (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

  SELECT COALESCE(gender, 'female') INTO v_gender FROM public.user_avatars WHERE user_id = _user_id;
  IF v_gender = 'male' THEN
    v_th20 := 500; v_th40 := 1000; v_th60 := 1750; v_th80 := 2500; v_th100 := 4000;
  ELSE
    v_th20 := 250; v_th40 := 500;  v_th60 := 875;  v_th80 := 1250; v_th100 := 2000;
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(
      (SELECT SUM((s->>'weight')::numeric * COALESCE((s->>'reps')::numeric, 0))
       FROM jsonb_array_elements(COALESCE(sets, '[]'::jsonb)) s),
      COALESCE(weight,0) * COALESCE(reps,0)
    )
  ), 0) INTO v_volume
  FROM public.workouts WHERE user_id = _user_id AND workout_date = _workout_date;

  v_volume_bonus := CASE
    WHEN v_volume >= v_th100 THEN 100
    WHEN v_volume >= v_th80  THEN 80
    WHEN v_volume >= v_th60  THEN 60
    WHEN v_volume >= v_th40  THEN 40
    WHEN v_volume >= v_th20  THEN 20
    ELSE 0
  END;

  WITH today_max AS (
    SELECT w.exercise_id, e.name AS exercise_name,
           MAX(public._workout_max_weight(w.sets, w.weight)) AS w
    FROM public.workouts w
    LEFT JOIN public.exercises e ON e.id = w.exercise_id
    WHERE w.user_id = _user_id AND w.workout_date = _workout_date
    GROUP BY w.exercise_id, e.name
  ),
  prev_max AS (
    SELECT w.exercise_id, MAX(public._workout_max_weight(w.sets, w.weight)) AS w
    FROM public.workouts w
    WHERE w.user_id = _user_id AND w.workout_date < _workout_date
    GROUP BY w.exercise_id
  ),
  prs AS (
    SELECT t.exercise_id, t.exercise_name, t.w AS today_w, COALESCE(p.w, 0) AS prev_w
    FROM today_max t LEFT JOIN prev_max p USING (exercise_id)
    WHERE t.w > 0 AND t.w > COALESCE(p.w, 0)
  )
  SELECT COUNT(*), COALESCE(jsonb_agg(exercise_name), '[]'::jsonb) INTO v_pr_count, v_pr_exercises FROM prs;

  v_session_base := 3 * (100 + v_volume_bonus + (COALESCE(v_pr_count, 0) * 30));

  INSERT INTO public.training_sessions (user_id, session_date, exp_awarded)
  VALUES (_user_id, _workout_date, v_session_base)
  ON CONFLICT (user_id, session_date) DO UPDATE SET exp_awarded = EXCLUDED.exp_awarded
  RETURNING id INTO v_session_id;

  SELECT COUNT(*), COALESCE(SUM(exp_awarded),0)
  INTO v_today_count, v_today_sum
  FROM public.training_sessions
  WHERE user_id = _user_id AND session_date = _workout_date;

  SELECT EXISTS(
    SELECT 1 FROM public.training_sessions
    WHERE user_id = _user_id AND session_date = _workout_date - INTERVAL '1 day'
  ) INTO v_yesterday_exists;

  IF v_yesterday_exists THEN
    SELECT COALESCE(MAX(combo_streak),0)+1 INTO v_combo_streak
    FROM public.training_sessions
    WHERE user_id = _user_id AND session_date = _workout_date - INTERVAL '1 day';
  ELSE
    v_combo_streak := 1;
  END IF;

  v_mult := LEAST(2.0, 1.0 + (v_combo_streak - 1) * 0.1);
  v_combo_bonus := FLOOR(v_today_sum * (v_mult - 1.0));
  v_total_exp := v_today_sum + v_combo_bonus;
  v_coins := FLOOR(v_total_exp / 10);

  UPDATE public.training_sessions
  SET combo_streak = v_combo_streak,
      combo_multiplier = v_mult,
      combo_bonus_exp = v_combo_bonus,
      total_exp_awarded = v_total_exp,
      coins_awarded = v_coins
  WHERE id = v_session_id;

  SELECT level, total_exp INTO v_avatar_lvl_before, v_avatar_total_exp_before
  FROM public.user_avatars WHERE user_id = _user_id;

  v_rank_before := public.compute_rank_for_level(COALESCE(v_avatar_lvl_before,1));

  INSERT INTO public.avatar_exp_logs (user_id, source, source_id, exp_amount)
  VALUES (_user_id, 'training_session', v_session_id, v_total_exp);

  UPDATE public.profiles
  SET coins = COALESCE(coins,0) + v_coins
  WHERE id = _user_id;

  SELECT level INTO v_avatar_lvl_after FROM public.user_avatars WHERE user_id = _user_id;
  v_rank_after := public.compute_rank_for_level(COALESCE(v_avatar_lvl_after,1));

  IF v_rank_after IS DISTINCT FROM v_rank_before THEN
    v_rank_up := true;
    v_rank_bonus_coins := 200;
    v_rank_bonus_tickets := 1;
    UPDATE public.profiles
    SET coins = COALESCE(coins,0) + v_rank_bonus_coins,
        gacha_tickets = COALESCE(gacha_tickets,0) + v_rank_bonus_tickets
    WHERE id = _user_id;
  END IF;

  -- Grant active companion EXP (half of avatar EXP)
  v_comp_exp_gain := FLOOR(v_total_exp / 2);
  IF v_comp_exp_gain > 0 THEN
    SELECT * INTO v_comp FROM public.user_companions
     WHERE user_id = _user_id AND is_active = true LIMIT 1;
    IF FOUND THEN
      v_comp_new_exp := v_comp.exp + v_comp_exp_gain;
      v_comp_new_level := v_comp.level;
      WHILE v_comp_new_exp >= v_comp_new_level * 100 LOOP
        v_comp_new_exp := v_comp_new_exp - v_comp_new_level * 100;
        v_comp_new_level := v_comp_new_level + 1;
      END LOOP;

      SELECT * INTO v_evo_def FROM public.companion_defs
       WHERE evolves_from = v_comp.companion_key AND evolve_level <= v_comp_new_level
       LIMIT 1;

      IF FOUND THEN
        v_comp_evolved := true;
        v_comp_name := v_evo_def.companion_name;
        UPDATE public.user_companions SET
          companion_key = v_evo_def.companion_key,
          companion_name = v_evo_def.companion_name,
          element = v_evo_def.element,
          level = v_comp_new_level,
          exp = v_comp_new_exp,
          base_atk = v_evo_def.base_atk,
          base_def = v_evo_def.base_def,
          base_hp = v_evo_def.base_hp,
          image_path = v_evo_def.image_path
        WHERE id = v_comp.id;
      ELSE
        v_comp_name := v_comp.companion_name;
        UPDATE public.user_companions SET
          level = v_comp_new_level,
          exp = v_comp_new_exp
        WHERE id = v_comp.id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'session_base_exp', v_session_base,
    'volume', v_volume,
    'volume_bonus', v_volume_bonus,
    'pr_count', v_pr_count,
    'pr_exercises', v_pr_exercises,
    'today_count', v_today_count,
    'combo_streak', v_combo_streak,
    'combo_multiplier', v_mult,
    'combo_bonus_exp', v_combo_bonus,
    'total_exp', v_total_exp,
    'coins', v_coins,
    'rank_up', v_rank_up,
    'rank_before', v_rank_before,
    'rank_after', v_rank_after,
    'rank_bonus_coins', v_rank_bonus_coins,
    'rank_bonus_tickets', v_rank_bonus_tickets,
    'avatar_level_before', v_avatar_lvl_before,
    'avatar_level_after', v_avatar_lvl_after,
    'companion_exp_gained', v_comp_exp_gain,
    'companion_name', v_comp_name,
    'companion_evolved', v_comp_evolved
  );
END;
$function$;

-- New RPC: grant_companion_exp (used by dungeon completion)
CREATE OR REPLACE FUNCTION public.grant_companion_exp(p_user_id uuid, p_exp int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_comp record;
  v_new_exp int;
  v_new_level int;
  v_evo_def record;
  v_evolved boolean := false;
BEGIN
  IF p_exp IS NULL OR p_exp <= 0 THEN
    RETURN jsonb_build_object('exp_gained', 0);
  END IF;

  SELECT * INTO v_comp FROM public.user_companions
   WHERE user_id = p_user_id AND is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('exp_gained', 0);
  END IF;

  v_new_exp := v_comp.exp + p_exp;
  v_new_level := v_comp.level;
  WHILE v_new_exp >= v_new_level * 100 LOOP
    v_new_exp := v_new_exp - v_new_level * 100;
    v_new_level := v_new_level + 1;
  END LOOP;

  SELECT * INTO v_evo_def FROM public.companion_defs
   WHERE evolves_from = v_comp.companion_key AND evolve_level <= v_new_level
   LIMIT 1;

  IF FOUND THEN
    v_evolved := true;
    UPDATE public.user_companions SET
      companion_key = v_evo_def.companion_key,
      companion_name = v_evo_def.companion_name,
      element = v_evo_def.element,
      level = v_new_level,
      exp = v_new_exp,
      base_atk = v_evo_def.base_atk,
      base_def = v_evo_def.base_def,
      base_hp = v_evo_def.base_hp,
      image_path = v_evo_def.image_path
    WHERE id = v_comp.id;
    RETURN jsonb_build_object(
      'exp_gained', p_exp,
      'companion_name', v_evo_def.companion_name,
      'level', v_new_level,
      'evolved', true
    );
  ELSE
    UPDATE public.user_companions SET
      level = v_new_level,
      exp = v_new_exp
    WHERE id = v_comp.id;
    RETURN jsonb_build_object(
      'exp_gained', p_exp,
      'companion_name', v_comp.companion_name,
      'level', v_new_level,
      'evolved', false
    );
  END IF;
END;
$$;
