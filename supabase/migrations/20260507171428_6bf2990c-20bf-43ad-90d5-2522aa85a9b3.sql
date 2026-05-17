
-- ============================================
-- GACHA RESULTS
-- ============================================
CREATE TABLE public.gacha_results (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  result_date date NOT NULL,
  reward_type text NOT NULL,
  reward_key text,
  reward_amount integer,
  rarity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, result_date)
);

ALTER TABLE public.gacha_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own gacha results" ON public.gacha_results
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users insert own gacha results" ON public.gacha_results
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Trainers insert any gacha results" ON public.gacha_results
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

-- ============================================
-- SEASON EVENTS
-- ============================================
CREATE TABLE public.season_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_name text NOT NULL,
  event_description text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  event_icon text,
  reward_exp integer NOT NULL DEFAULT 500,
  reward_coins integer NOT NULL DEFAULT 50,
  reward_badge_key text,
  badge_name text,
  badge_icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.season_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view events" ON public.season_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Trainers manage events insert" ON public.season_events
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers manage events update" ON public.season_events
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers manage events delete" ON public.season_events
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'trainer'::app_role));

-- ============================================
-- SEASON EVENT TASKS
-- ============================================
CREATE TABLE public.season_event_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.season_events(id) ON DELETE CASCADE,
  task_key text NOT NULL,
  task_name text NOT NULL,
  task_description text,
  task_icon text,
  target_value integer NOT NULL,
  task_type text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.season_event_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view tasks" ON public.season_event_tasks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Trainers manage tasks insert" ON public.season_event_tasks
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers manage tasks update" ON public.season_event_tasks
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers manage tasks delete" ON public.season_event_tasks
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'trainer'::app_role));

-- ============================================
-- USER EVENT PROGRESS
-- ============================================
CREATE TABLE public.user_event_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES public.season_events(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.season_event_tasks(id) ON DELETE CASCADE,
  current_value integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, task_id)
);

ALTER TABLE public.user_event_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own progress" ON public.user_event_progress
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users insert own progress" ON public.user_event_progress
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users update own progress" ON public.user_event_progress
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- ============================================
-- USER EVENT COMPLETION
-- ============================================
CREATE TABLE public.user_event_completion (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  event_id uuid NOT NULL REFERENCES public.season_events(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

ALTER TABLE public.user_event_completion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own completion" ON public.user_event_completion
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users insert own completion" ON public.user_event_completion
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- ============================================
-- RPC: spin_gacha
-- ============================================
CREATE OR REPLACE FUNCTION public.spin_gacha(_user_id uuid, _result_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing record;
  v_roll integer;
  v_rarity text;
  v_pool jsonb;
  v_idx integer;
  v_reward jsonb;
  v_total_exp integer;
  v_old_level integer;
  v_new_level integer;
  v_required integer;
  v_cumulative integer := 0;
  v_lvl integer := 1;
  v_added_coins integer := 0;
BEGIN
  -- Already spun today?
  SELECT * INTO v_existing FROM public.gacha_results
  WHERE user_id = _user_id AND result_date = _result_date;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'already', true,
      'reward_type', v_existing.reward_type,
      'reward_amount', v_existing.reward_amount,
      'rarity', v_existing.rarity
    );
  END IF;

  -- Determine rarity
  v_roll := floor(random() * 100)::int;
  IF v_roll < 60 THEN v_rarity := 'common';
  ELSIF v_roll < 85 THEN v_rarity := 'rare';
  ELSIF v_roll < 97 THEN v_rarity := 'epic';
  ELSE v_rarity := 'legendary';
  END IF;

  -- Pool per rarity (type, amount)
  v_pool := CASE v_rarity
    WHEN 'common' THEN '[
      {"type":"coins","amount":5},{"type":"coins","amount":10},
      {"type":"exp","amount":20},{"type":"exp","amount":30}]'::jsonb
    WHEN 'rare' THEN '[
      {"type":"coins","amount":25},{"type":"coins","amount":30},
      {"type":"exp","amount":50},{"type":"exp","amount":75}]'::jsonb
    WHEN 'epic' THEN '[
      {"type":"coins","amount":50},{"type":"coins","amount":75},
      {"type":"exp","amount":100}]'::jsonb
    ELSE '[
      {"type":"coins","amount":150},{"type":"coins","amount":200},
      {"type":"exp","amount":200}]'::jsonb
  END;

  v_idx := floor(random() * jsonb_array_length(v_pool))::int;
  v_reward := v_pool -> v_idx;

  -- Insert gacha result
  INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_amount, rarity)
  VALUES (_user_id, _result_date, v_reward->>'type', (v_reward->>'amount')::int, v_rarity);

  -- Ensure avatar row
  INSERT INTO public.user_avatars (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

  IF v_reward->>'type' = 'coins' THEN
    UPDATE public.user_avatars SET coins = coins + (v_reward->>'amount')::int, updated_at = now()
    WHERE user_id = _user_id;
  ELSE
    -- EXP reward: log + recompute level
    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
    VALUES (_user_id, (v_reward->>'amount')::int, 'gacha|' || _result_date::text, _result_date)
    ON CONFLICT DO NOTHING;

    SELECT level INTO v_old_level FROM public.user_avatars WHERE user_id = _user_id;
    SELECT COALESCE(SUM(exp_amount),0) INTO v_total_exp FROM public.avatar_exp_logs WHERE user_id = _user_id;
    WHILE v_lvl < 999 LOOP
      v_required := 250 + v_lvl * 50;
      EXIT WHEN v_total_exp < v_cumulative + v_required;
      v_cumulative := v_cumulative + v_required;
      v_lvl := v_lvl + 1;
    END LOOP;
    v_new_level := v_lvl;
    v_added_coins := GREATEST(0, v_new_level - COALESCE(v_old_level,1)) * 10;
    UPDATE public.user_avatars
    SET total_exp = v_total_exp,
        level = v_new_level,
        coins = coins + v_added_coins,
        updated_at = now()
    WHERE user_id = _user_id;
  END IF;

  RETURN jsonb_build_object(
    'already', false,
    'reward_type', v_reward->>'type',
    'reward_amount', (v_reward->>'amount')::int,
    'rarity', v_rarity
  );
END;
$$;

-- ============================================
-- RPC: update_event_progress
-- Called after workout save / mission complete
-- ============================================
CREATE OR REPLACE FUNCTION public.update_event_progress(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event record;
  v_task record;
  v_value integer;
  v_all_done boolean;
  v_completed_events jsonb := '[]'::jsonb;
  v_total_exp integer;
  v_old_level integer;
  v_new_level integer;
  v_added_coins integer;
  v_required integer;
  v_cumulative integer;
  v_lvl integer;
BEGIN
  FOR v_event IN
    SELECT * FROM public.season_events
    WHERE is_active = true
      AND CURRENT_DATE BETWEEN start_date AND end_date
  LOOP
    -- Skip if already completed
    IF EXISTS (SELECT 1 FROM public.user_event_completion
               WHERE user_id = _user_id AND event_id = v_event.id) THEN
      CONTINUE;
    END IF;

    FOR v_task IN
      SELECT * FROM public.season_event_tasks WHERE event_id = v_event.id
    LOOP
      v_value := 0;
      IF v_task.task_type = 'session_count' THEN
        SELECT COUNT(DISTINCT workout_date) INTO v_value FROM public.workouts
        WHERE user_id = _user_id AND workout_date BETWEEN v_event.start_date AND v_event.end_date;
      ELSIF v_task.task_type = 'total_volume' THEN
        SELECT COALESCE(SUM(
          weight * reps * COALESCE(jsonb_array_length(sets), 1)
        ), 0)::int INTO v_value
        FROM public.workouts
        WHERE user_id = _user_id
          AND workout_date BETWEEN v_event.start_date AND v_event.end_date
          AND weight IS NOT NULL AND reps IS NOT NULL;
      ELSIF v_task.task_type = 'muscle_groups' THEN
        SELECT COUNT(DISTINCT e.muscle_group) INTO v_value
        FROM public.workouts w JOIN public.exercises e ON e.id = w.exercise_id
        WHERE w.user_id = _user_id
          AND w.workout_date BETWEEN v_event.start_date AND v_event.end_date;
      ELSIF v_task.task_type = 'personal_bests' THEN
        -- Approx: count exercises whose max weight in window equals lifetime max
        SELECT COUNT(*) INTO v_value FROM (
          SELECT w.exercise_id,
                 MAX(w.weight) FILTER (WHERE w.workout_date BETWEEN v_event.start_date AND v_event.end_date) AS win_max,
                 MAX(w.weight) AS all_max
          FROM public.workouts w
          WHERE w.user_id = _user_id
          GROUP BY w.exercise_id
        ) s WHERE s.win_max IS NOT NULL AND s.win_max = s.all_max;
      ELSIF v_task.task_type = 'missions_completed' THEN
        SELECT COALESCE(SUM(COALESCE(array_length(completed_keys,1),0)),0) INTO v_value
        FROM public.daily_missions
        WHERE user_id = _user_id
          AND mission_date BETWEEN v_event.start_date AND v_event.end_date;
      END IF;

      INSERT INTO public.user_event_progress (user_id, event_id, task_id, current_value, completed, completed_at)
      VALUES (_user_id, v_event.id, v_task.id, v_value, v_value >= v_task.target_value,
              CASE WHEN v_value >= v_task.target_value THEN now() ELSE NULL END)
      ON CONFLICT (user_id, task_id) DO UPDATE
      SET current_value = EXCLUDED.current_value,
          completed = EXCLUDED.completed,
          completed_at = COALESCE(public.user_event_progress.completed_at, EXCLUDED.completed_at),
          updated_at = now();
    END LOOP;

    -- Check if all tasks completed
    SELECT bool_and(p.completed) INTO v_all_done
    FROM public.season_event_tasks t
    LEFT JOIN public.user_event_progress p ON p.task_id = t.id AND p.user_id = _user_id
    WHERE t.event_id = v_event.id;

    IF v_all_done THEN
      INSERT INTO public.user_event_completion (user_id, event_id)
      VALUES (_user_id, v_event.id)
      ON CONFLICT (user_id, event_id) DO NOTHING;

      -- Reward EXP + coins + badge
      INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
      VALUES (_user_id, v_event.reward_exp, 'event_reward|' || v_event.id::text, CURRENT_DATE)
      ON CONFLICT DO NOTHING;

      IF v_event.reward_badge_key IS NOT NULL THEN
        INSERT INTO public.avatar_achievements (user_id, achievement_key)
        VALUES (_user_id, v_event.reward_badge_key)
        ON CONFLICT DO NOTHING;
      END IF;

      -- recompute level
      SELECT level INTO v_old_level FROM public.user_avatars WHERE user_id = _user_id;
      SELECT COALESCE(SUM(exp_amount),0) INTO v_total_exp FROM public.avatar_exp_logs WHERE user_id = _user_id;
      v_cumulative := 0; v_lvl := 1;
      WHILE v_lvl < 999 LOOP
        v_required := 250 + v_lvl * 50;
        EXIT WHEN v_total_exp < v_cumulative + v_required;
        v_cumulative := v_cumulative + v_required;
        v_lvl := v_lvl + 1;
      END LOOP;
      v_new_level := v_lvl;
      v_added_coins := GREATEST(0, v_new_level - COALESCE(v_old_level,1)) * 10 + v_event.reward_coins;
      UPDATE public.user_avatars
      SET total_exp = v_total_exp, level = v_new_level,
          coins = coins + v_added_coins, updated_at = now()
      WHERE user_id = _user_id;

      v_completed_events := v_completed_events || jsonb_build_object(
        'event_id', v_event.id,
        'event_name', v_event.event_name,
        'badge_key', v_event.reward_badge_key,
        'badge_name', v_event.badge_name,
        'reward_exp', v_event.reward_exp,
        'reward_coins', v_event.reward_coins
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('completed_events', v_completed_events);
END;
$$;

-- ============================================
-- Seed: Summer event 2026
-- ============================================
INSERT INTO public.season_events (event_name, event_description, start_date, end_date, event_icon, reward_exp, reward_coins, reward_badge_key, badge_name, badge_icon)
VALUES ('夏に向けてボディメイクチャレンジ', '6月は集中トレーニング月間！全タスクをクリアしてサマーウォリアーの称号を手に入れよう', '2026-06-01', '2026-06-30', '🏖️', 500, 50, 'summer_warrior_2026', 'サマーウォリアー2026', '🏖️');

INSERT INTO public.season_event_tasks (event_id, task_key, task_name, task_description, task_icon, target_value, task_type, sort_order)
SELECT id, 'summer_sessions', '4回以上来店する', '6月中に4回以上トレーニング', '🏃', 4, 'session_count', 1
FROM public.season_events WHERE reward_badge_key = 'summer_warrior_2026';

INSERT INTO public.season_event_tasks (event_id, task_key, task_name, task_description, task_icon, target_value, task_type, sort_order)
SELECT id, 'summer_volume', '総挙上量50,000kg', '6月の合計挙上量', '🏋️', 50000, 'total_volume', 2
FROM public.season_events WHERE reward_badge_key = 'summer_warrior_2026';

INSERT INTO public.season_event_tasks (event_id, task_key, task_name, task_description, task_icon, target_value, task_type, sort_order)
SELECT id, 'summer_pb', '3種目で自己ベスト更新', '6月中に自己ベスト更新', '🏆', 3, 'personal_bests', 3
FROM public.season_events WHERE reward_badge_key = 'summer_warrior_2026';

INSERT INTO public.season_event_tasks (event_id, task_key, task_name, task_description, task_icon, target_value, task_type, sort_order)
SELECT id, 'summer_missions', 'ミッション10回達成', '6月中のデイリーミッション', '🎯', 10, 'missions_completed', 4
FROM public.season_events WHERE reward_badge_key = 'summer_warrior_2026';
