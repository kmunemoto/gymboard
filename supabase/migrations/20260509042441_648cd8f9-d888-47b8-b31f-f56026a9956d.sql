
-- ========== Part 1: Drop Season Pass ==========
DROP TRIGGER IF EXISTS trg_premium_exp_multiplier ON public.avatar_exp_logs;
DROP FUNCTION IF EXISTS public.apply_premium_exp_multiplier() CASCADE;
DROP FUNCTION IF EXISTS public.add_season_pass_points(uuid, integer, text) CASCADE;
DROP FUNCTION IF EXISTS public.claim_season_pass_reward(uuid, integer, text) CASCADE;
DROP FUNCTION IF EXISTS public.purchase_premium_pass(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_current_season_config() CASCADE;
DROP TABLE IF EXISTS public.user_season_pass_claims CASCADE;
DROP TABLE IF EXISTS public.user_season_pass CASCADE;
DROP TABLE IF EXISTS public.season_pass_levels CASCADE;
DROP TABLE IF EXISTS public.season_pass_config CASCADE;

-- Re-create claim_daily_login_bonus without season pass
CREATE OR REPLACE FUNCTION public.claim_daily_login_bonus(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_yesterday date := v_today - 1;
  v_existing public.daily_login_bonuses;
  v_prev public.daily_login_bonuses;
  v_day_number int;
  v_streak_reset boolean := false;
  v_reward_type text;
  v_reward_amount int;
BEGIN
  SELECT * INTO v_existing FROM public.daily_login_bonuses
    WHERE user_id = p_user_id AND login_date = v_today;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'already_claimed', true,
      'day_number', v_existing.day_number,
      'reward_type', v_existing.reward_type,
      'reward_amount', v_existing.reward_amount
    );
  END IF;

  SELECT * INTO v_prev FROM public.daily_login_bonuses
    WHERE user_id = p_user_id AND login_date = v_yesterday;
  IF FOUND THEN
    v_day_number := v_prev.day_number + 1;
    IF v_day_number > 7 THEN v_day_number := 1; END IF;
  ELSE
    v_day_number := 1;
    IF EXISTS (SELECT 1 FROM public.daily_login_bonuses WHERE user_id = p_user_id) THEN
      v_streak_reset := true;
    END IF;
  END IF;

  CASE v_day_number
    WHEN 1 THEN v_reward_type := 'coins';        v_reward_amount := 5;
    WHEN 2 THEN v_reward_type := 'exp';          v_reward_amount := 20;
    WHEN 3 THEN v_reward_type := 'coins';        v_reward_amount := 10;
    WHEN 4 THEN v_reward_type := 'exp';          v_reward_amount := 30;
    WHEN 5 THEN v_reward_type := 'coins';        v_reward_amount := 15;
    WHEN 6 THEN v_reward_type := 'exp';          v_reward_amount := 50;
    WHEN 7 THEN v_reward_type := 'gacha_ticket'; v_reward_amount := 1;
  END CASE;

  INSERT INTO public.daily_login_bonuses(user_id, login_date, day_number, reward_type, reward_amount)
  VALUES (p_user_id, v_today, v_day_number, v_reward_type, v_reward_amount);

  IF v_reward_type = 'coins' THEN
    UPDATE public.user_avatars SET coins = coins + v_reward_amount, updated_at = now()
      WHERE user_id = p_user_id;
  ELSIF v_reward_type = 'exp' THEN
    INSERT INTO public.avatar_exp_logs(user_id, exp_amount, reason, reference_date)
    VALUES (p_user_id, v_reward_amount, 'login_bonus', v_today);
  ELSIF v_reward_type = 'gacha_ticket' THEN
    INSERT INTO public.user_gacha_tickets(user_id) VALUES (p_user_id);
  END IF;

  RETURN jsonb_build_object(
    'already_claimed', false,
    'day_number', v_day_number,
    'reward_type', v_reward_type,
    'reward_amount', v_reward_amount,
    'extra_coins', 0,
    'streak_reset', v_streak_reset
  );
END;
$function$;

-- ========== Part 2: Training Milestones ==========
CREATE TABLE IF NOT EXISTS public.training_milestones (
  id integer PRIMARY KEY,
  session_count integer UNIQUE NOT NULL,
  milestone_name text NOT NULL,
  reward_coins integer NOT NULL DEFAULT 0,
  reward_exp integer NOT NULL DEFAULT 0,
  reward_gacha_tickets integer NOT NULL DEFAULT 0,
  reward_title text,
  reward_badge_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.training_milestones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated views training milestones"
  ON public.training_milestones FOR SELECT TO authenticated USING (true);

INSERT INTO public.training_milestones(id, session_count, milestone_name, reward_coins, reward_exp, reward_gacha_tickets, reward_title, reward_badge_key) VALUES
  (1,  10, 'ビギナー卒業',     30,  100, 1, NULL,                       'milestone_10'),
  (2,  25, 'クォーター達成',   50,  200, 2, 'milestone_regular',        'milestone_25'),
  (3,  50, 'ハーフセンチュリー',100, 300, 3, 'milestone_veteran',        'milestone_50'),
  (4,  75, 'シルバーセッション',150, 400, 3, NULL,                       'milestone_75'),
  (5, 100, 'センチュリー達成', 200,  500, 5, 'milestone_iron_man',       'milestone_100'),
  (6, 150, 'レジェンドへの道', 300,  700, 5, NULL,                       'milestone_150'),
  (7, 200, 'ダブルセンチュリー',500,1000,10, 'milestone_legend_trainee', 'milestone_200')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_milestone_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  milestone_id integer NOT NULL REFERENCES public.training_milestones(id),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, milestone_id)
);

ALTER TABLE public.user_milestone_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own milestone claims"
  ON public.user_milestone_claims FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own milestone claims"
  ON public.user_milestone_claims FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- ========== Part 3: Helper to compute max weight from a workouts row ==========
CREATE OR REPLACE FUNCTION public._workout_max_weight(_sets jsonb, _weight numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    COALESCE(_weight, 0),
    COALESCE((SELECT MAX((s->>'weight')::numeric) FROM jsonb_array_elements(COALESCE(_sets, '[]'::jsonb)) s), 0)
  )
$$;

-- ========== Part 4: check_training_milestones RPC ==========
CREATE OR REPLACE FUNCTION public.check_training_milestones(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_sessions int;
  v_results jsonb := '[]'::jsonb;
  v_m record;
BEGIN
  SELECT COUNT(DISTINCT workout_date) INTO v_total_sessions
    FROM public.workouts WHERE user_id = p_user_id;

  FOR v_m IN
    SELECT m.* FROM public.training_milestones m
    WHERE m.session_count <= v_total_sessions
      AND NOT EXISTS (SELECT 1 FROM public.user_milestone_claims c
                      WHERE c.user_id = p_user_id AND c.milestone_id = m.id)
    ORDER BY m.session_count
  LOOP
    INSERT INTO public.user_milestone_claims(user_id, milestone_id)
      VALUES (p_user_id, v_m.id);

    -- coins
    IF v_m.reward_coins > 0 THEN
      UPDATE public.user_avatars SET coins = COALESCE(coins,0) + v_m.reward_coins, updated_at = now()
        WHERE user_id = p_user_id;
    END IF;
    -- exp
    IF v_m.reward_exp > 0 THEN
      INSERT INTO public.avatar_exp_logs(user_id, exp_amount, reason, reference_date)
        VALUES (p_user_id, v_m.reward_exp, 'milestone|' || v_m.id::text, (now() AT TIME ZONE 'Asia/Tokyo')::date)
        ON CONFLICT DO NOTHING;
    END IF;
    -- tickets
    FOR i IN 1..COALESCE(v_m.reward_gacha_tickets, 0) LOOP
      INSERT INTO public.user_gacha_tickets(user_id, session_date) VALUES (p_user_id, NULL);
    END LOOP;
    -- title
    IF v_m.reward_title IS NOT NULL THEN
      INSERT INTO public.user_titles(user_id, title_key) VALUES (p_user_id, v_m.reward_title)
        ON CONFLICT DO NOTHING;
    END IF;
    -- badge
    IF v_m.reward_badge_key IS NOT NULL THEN
      INSERT INTO public.avatar_achievements(user_id, achievement_key) VALUES (p_user_id, v_m.reward_badge_key)
        ON CONFLICT DO NOTHING;
    END IF;

    v_results := v_results || jsonb_build_object(
      'id', v_m.id,
      'session_count', v_m.session_count,
      'milestone_name', v_m.milestone_name,
      'reward_coins', v_m.reward_coins,
      'reward_exp', v_m.reward_exp,
      'reward_gacha_tickets', v_m.reward_gacha_tickets,
      'reward_title', v_m.reward_title,
      'reward_badge_key', v_m.reward_badge_key
    );
  END LOOP;

  RETURN jsonb_build_object('total_sessions', v_total_sessions, 'achieved', v_results);
END;
$$;

-- ========== Part 5: Modified process_session_rewards ==========
CREATE OR REPLACE FUNCTION public.process_session_rewards(_user_id uuid, _workout_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_avatar record;
  v_old_combo integer;
  v_new_combo integer;
  v_diff_days integer;
  v_mult numeric;
  v_today_sum integer;
  v_combo_bonus integer;
  v_total_exp integer;
  v_old_level integer;
  v_new_level integer;
  v_added_coins integer;
  v_required integer;
  v_cumulative integer := 0;
  v_lvl integer := 1;
  v_old_rank text;
  v_new_rank text;
  v_rank_coins integer;
  v_rank_tickets integer;
  v_i integer;
  v_rank_up jsonb := NULL;
  v_gender text;
  v_volume numeric;
  v_volume_bonus integer;
  v_pr_count integer;
  v_pr_exercises jsonb;
  v_session_base integer;
  v_th20 numeric; v_th40 numeric; v_th60 numeric; v_th80 numeric; v_th100 numeric;
BEGIN
  INSERT INTO public.user_avatars (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

  -- gender
  SELECT COALESCE(gender, 'female') INTO v_gender FROM public.user_avatars WHERE user_id = _user_id;
  IF v_gender = 'male' THEN
    v_th20 := 1000; v_th40 := 2000; v_th60 := 3500; v_th80 := 5000; v_th100 := 8000;
  ELSE
    v_th20 := 500;  v_th40 := 1000; v_th60 := 1750; v_th80 := 2500; v_th100 := 4000;
  END IF;

  -- session volume
  SELECT COALESCE(SUM(public._workout_max_weight(sets, weight) * 0), 0) INTO v_volume; -- init
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

  -- personal best detection: per exercise, today's max > all-prior-days max
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

  v_session_base := 100 + v_volume_bonus + (COALESCE(v_pr_count, 0) * 30);

  -- Insert/replace session row for the date
  DELETE FROM public.avatar_exp_logs
    WHERE user_id = _user_id AND reference_date = _workout_date AND reason = 'session|' || _workout_date::text;
  INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
  VALUES (_user_id, v_session_base, 'session|' || _workout_date::text, _workout_date);

  SELECT * INTO v_avatar FROM public.user_avatars WHERE user_id = _user_id FOR UPDATE;
  v_old_combo := COALESCE(v_avatar.combo_count, 0);
  v_old_level := COALESCE(v_avatar.level, 1);

  IF v_avatar.last_session_date IS NULL THEN
    v_new_combo := 1;
  ELSIF v_avatar.last_session_date = _workout_date THEN
    v_new_combo := GREATEST(v_old_combo, 1);
  ELSE
    v_diff_days := _workout_date - v_avatar.last_session_date;
    IF v_diff_days BETWEEN 1 AND 7 THEN
      v_new_combo := v_old_combo + 1;
    ELSE
      v_new_combo := 1;
    END IF;
  END IF;

  v_mult := CASE
    WHEN v_new_combo <= 1 THEN 1.0
    WHEN v_new_combo = 2 THEN 1.2
    WHEN v_new_combo = 3 THEN 1.5
    WHEN v_new_combo = 4 THEN 1.8
    ELSE 2.0
  END;

  SELECT COALESCE(SUM(exp_amount), 0) INTO v_today_sum
  FROM public.avatar_exp_logs
  WHERE user_id = _user_id
    AND reference_date = _workout_date
    AND reason NOT LIKE 'combo_bonus|%';

  v_combo_bonus := FLOOR(v_today_sum * (v_mult - 1.0))::integer;

  IF v_combo_bonus > 0 THEN
    DELETE FROM public.avatar_exp_logs
    WHERE user_id = _user_id AND reference_date = _workout_date AND reason LIKE 'combo_bonus|%';
    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
    VALUES (_user_id, v_combo_bonus, 'combo_bonus|' || _workout_date::text, _workout_date);
  END IF;

  SELECT COALESCE(SUM(exp_amount), 0) INTO v_total_exp
  FROM public.avatar_exp_logs WHERE user_id = _user_id;

  WHILE v_lvl < 999 LOOP
    v_required := 250 + v_lvl * 50;
    EXIT WHEN v_total_exp < v_cumulative + v_required;
    v_cumulative := v_cumulative + v_required;
    v_lvl := v_lvl + 1;
  END LOOP;
  v_new_level := v_lvl;
  v_added_coins := GREATEST(0, v_new_level - v_old_level) * 10;

  v_old_rank := CASE
    WHEN v_old_level <= 5 THEN 'rookie'
    WHEN v_old_level <= 15 THEN 'regular'
    WHEN v_old_level <= 30 THEN 'athlete'
    WHEN v_old_level <= 50 THEN 'elite'
    ELSE 'legend'
  END;
  v_new_rank := CASE
    WHEN v_new_level <= 5 THEN 'rookie'
    WHEN v_new_level <= 15 THEN 'regular'
    WHEN v_new_level <= 30 THEN 'athlete'
    WHEN v_new_level <= 50 THEN 'elite'
    ELSE 'legend'
  END;

  UPDATE public.user_avatars
  SET total_exp = v_total_exp,
      level = v_new_level,
      coins = COALESCE(coins, 0) + v_added_coins,
      combo_count = v_new_combo,
      last_session_date = _workout_date,
      max_combo_reached = GREATEST(COALESCE(max_combo_reached, 0), v_new_combo),
      combo_5_count = combo_5_count + CASE
        WHEN v_new_combo >= 5 AND v_old_combo < 5 THEN 1
        ELSE 0
      END,
      updated_at = now()
  WHERE user_id = _user_id;

  IF v_new_rank IS DISTINCT FROM v_old_rank AND v_new_rank IN ('regular','athlete','elite','legend') THEN
    v_rank_coins := CASE v_new_rank WHEN 'regular' THEN 30 WHEN 'athlete' THEN 50 WHEN 'elite' THEN 100 WHEN 'legend' THEN 200 END;
    v_rank_tickets := CASE v_new_rank WHEN 'regular' THEN 2 WHEN 'athlete' THEN 3 WHEN 'elite' THEN 5 WHEN 'legend' THEN 10 END;
    BEGIN
      INSERT INTO public.avatar_rank_up_rewards (user_id, rank_name, coins_awarded, tickets_awarded)
      VALUES (_user_id, v_new_rank, v_rank_coins, v_rank_tickets);
      UPDATE public.user_avatars SET coins = coins + v_rank_coins WHERE user_id = _user_id;
      v_i := 0;
      WHILE v_i < v_rank_tickets LOOP
        INSERT INTO public.user_gacha_tickets (user_id, session_date) VALUES (_user_id, NULL);
        v_i := v_i + 1;
      END LOOP;
      v_rank_up := jsonb_build_object('rank', v_new_rank, 'coins', v_rank_coins, 'tickets', v_rank_tickets);
    EXCEPTION WHEN unique_violation THEN
      v_rank_up := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'combo', v_new_combo,
    'multiplier', v_mult,
    'combo_bonus', v_combo_bonus,
    'total_exp', v_total_exp,
    'level', v_new_level,
    'leveled_up', v_new_level > v_old_level,
    'rank_up', v_rank_up,
    'session_base', 100,
    'volume_kg', v_volume,
    'volume_bonus', v_volume_bonus,
    'pr_count', COALESCE(v_pr_count, 0),
    'pr_exercises', v_pr_exercises,
    'session_subtotal', v_session_base,
    'session_total', v_session_base + v_combo_bonus,
    'gender', v_gender
  );
END;
$function$;
