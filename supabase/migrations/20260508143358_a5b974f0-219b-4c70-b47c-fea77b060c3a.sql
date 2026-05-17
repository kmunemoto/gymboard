
-- ============ Tables ============
CREATE TABLE public.rival_battles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  week_end date NOT NULL,
  player1_id uuid NOT NULL,
  player2_id uuid NOT NULL,
  player1_volume numeric NOT NULL DEFAULT 0,
  player2_volume numeric NOT NULL DEFAULT 0,
  winner_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (week_start, player1_id),
  UNIQUE (week_start, player2_id)
);

CREATE INDEX idx_rival_battles_week ON public.rival_battles(week_start);
CREATE INDEX idx_rival_battles_p1 ON public.rival_battles(player1_id);
CREATE INDEX idx_rival_battles_p2 ON public.rival_battles(player2_id);

CREATE TABLE public.rival_battle_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  matched boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, week_start)
);

CREATE INDEX idx_rival_entries_week ON public.rival_battle_entries(week_start);

CREATE TABLE public.rival_battle_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL REFERENCES public.rival_battles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  result text NOT NULL CHECK (result IN ('win','lose','draw')),
  coins_earned integer NOT NULL,
  exp_earned integer NOT NULL,
  win_streak integer NOT NULL DEFAULT 0,
  streak_bonus_coins integer NOT NULL DEFAULT 0,
  claimed boolean NOT NULL DEFAULT false,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_id, user_id)
);

CREATE INDEX idx_rival_rewards_user ON public.rival_battle_rewards(user_id);

-- ============ RLS ============
ALTER TABLE public.rival_battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rival_battle_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rival_battle_rewards ENABLE ROW LEVEL SECURITY;

-- rival_battles
CREATE POLICY "Players view own battles" ON public.rival_battles
  FOR SELECT TO authenticated
  USING (auth.uid() = player1_id OR auth.uid() = player2_id OR has_role(auth.uid(), 'trainer'::app_role));

-- rival_battle_entries
CREATE POLICY "Users insert own entries" ON public.rival_battle_entries
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own entries" ON public.rival_battle_entries
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- rival_battle_rewards
CREATE POLICY "Users view own rewards" ON public.rival_battle_rewards
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users update own rewards" ON public.rival_battle_rewards
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============ Helper: week_start (Monday in JST) ============
CREATE OR REPLACE FUNCTION public.current_jst_monday()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT (date_trunc('week', (now() AT TIME ZONE 'Asia/Tokyo')))::date;
$$;

-- ============ enter_rival_battle ============
CREATE OR REPLACE FUNCTION public.enter_rival_battle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_week date;
  v_jst_dow int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;

  -- JST day-of-week: Monday = 1
  v_jst_dow := EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Asia/Tokyo'));
  IF v_jst_dow <> 1 THEN
    RAISE EXCEPTION 'エントリー期間は毎週月曜日です';
  END IF;

  v_week := public.current_jst_monday();

  INSERT INTO public.rival_battle_entries (user_id, week_start)
  VALUES (v_user, v_week)
  ON CONFLICT (user_id, week_start) DO NOTHING;

  RETURN jsonb_build_object('week_start', v_week, 'entered', true);
END;
$$;

-- ============ run_rival_matching ============
CREATE OR REPLACE FUNCTION public.run_rival_matching(p_week_start date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pairs int := 0;
  v_gender text;
  v_p1 record;
  v_p2 record;
  v_week_end date := p_week_start + 6;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(), 'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  FOR v_gender IN SELECT unnest(ARRAY['male','female']) LOOP
    -- Build ordered queue per gender
    DECLARE
      cur CURSOR FOR
        SELECT e.user_id, COALESCE(ua.level, 1) AS lvl
        FROM public.rival_battle_entries e
        LEFT JOIN public.user_avatars ua ON ua.user_id = e.user_id
        WHERE e.week_start = p_week_start
          AND e.matched = false
          AND COALESCE(ua.gender, '') = v_gender
        ORDER BY COALESCE(ua.level, 1) ASC, e.entered_at ASC;
    BEGIN
      v_p1 := NULL;
      OPEN cur;
      LOOP
        FETCH cur INTO v_p2;
        EXIT WHEN NOT FOUND;
        IF v_p1 IS NULL THEN
          v_p1 := v_p2;
        ELSE
          INSERT INTO public.rival_battles (week_start, week_end, player1_id, player2_id)
          VALUES (p_week_start, v_week_end, v_p1.user_id, v_p2.user_id)
          ON CONFLICT DO NOTHING;
          UPDATE public.rival_battle_entries SET matched = true
            WHERE week_start = p_week_start AND user_id IN (v_p1.user_id, v_p2.user_id);
          v_pairs := v_pairs + 1;
          v_p1 := NULL;
        END IF;
      END LOOP;
      CLOSE cur;
    END;
  END LOOP;

  RETURN jsonb_build_object('pairs_created', v_pairs, 'week_start', p_week_start);
END;
$$;

-- ============ update_rival_battle_volumes ============
CREATE OR REPLACE FUNCTION public.update_rival_battle_volumes(p_week_start date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_battle record;
  v_count int := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(), 'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  FOR v_battle IN
    SELECT * FROM public.rival_battles
    WHERE week_start = p_week_start AND status = 'active'
  LOOP
    UPDATE public.rival_battles
    SET player1_volume = COALESCE((
      SELECT SUM(
        CASE
          WHEN w.sets IS NOT NULL AND jsonb_typeof(w.sets) = 'array' AND jsonb_array_length(w.sets) > 0 THEN (
            SELECT COALESCE(SUM(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0)),0)
            FROM jsonb_array_elements(w.sets) s
          )
          ELSE COALESCE(w.weight,0) * COALESCE(w.reps,0)
        END
      )
      FROM public.workouts w
      WHERE w.user_id = v_battle.player1_id
        AND w.workout_date BETWEEN v_battle.week_start AND v_battle.week_end
    ), 0),
    player2_volume = COALESCE((
      SELECT SUM(
        CASE
          WHEN w.sets IS NOT NULL AND jsonb_typeof(w.sets) = 'array' AND jsonb_array_length(w.sets) > 0 THEN (
            SELECT COALESCE(SUM(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0)),0)
            FROM jsonb_array_elements(w.sets) s
          )
          ELSE COALESCE(w.weight,0) * COALESCE(w.reps,0)
        END
      )
      FROM public.workouts w
      WHERE w.user_id = v_battle.player2_id
        AND w.workout_date BETWEEN v_battle.week_start AND v_battle.week_end
    ), 0)
    WHERE id = v_battle.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_count, 'week_start', p_week_start);
END;
$$;

-- ============ complete_rival_battles ============
CREATE OR REPLACE FUNCTION public.complete_rival_battles(p_week_start date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_battle record;
  v_winner uuid;
  v_completed int := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_p_result text;
  v_p_streak int;
  v_p_coins int;
  v_p_exp int;
  v_p_bonus int;
  v_player_id uuid;
  v_other_id uuid;
  v_is_winner boolean;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(), 'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  -- Refresh volumes first
  PERFORM public.update_rival_battle_volumes(p_week_start);

  FOR v_battle IN
    SELECT * FROM public.rival_battles
    WHERE week_start = p_week_start
      AND status = 'active'
      AND week_end < v_today
  LOOP
    IF v_battle.player1_volume > v_battle.player2_volume THEN
      v_winner := v_battle.player1_id;
    ELSIF v_battle.player1_volume < v_battle.player2_volume THEN
      v_winner := v_battle.player2_id;
    ELSE
      v_winner := NULL;
    END IF;

    UPDATE public.rival_battles
    SET status = 'completed', winner_id = v_winner, completed_at = now()
    WHERE id = v_battle.id;

    -- Create reward records for both players
    FOR v_player_id, v_other_id IN
      SELECT v_battle.player1_id, v_battle.player2_id
      UNION ALL
      SELECT v_battle.player2_id, v_battle.player1_id
    LOOP
      IF v_winner IS NULL THEN
        v_p_result := 'draw'; v_p_coins := 30; v_p_exp := 50;
      ELSIF v_winner = v_player_id THEN
        v_p_result := 'win'; v_p_coins := 50; v_p_exp := 100;
      ELSE
        v_p_result := 'lose'; v_p_coins := 10; v_p_exp := 30;
      END IF;

      -- Calculate consecutive win streak (only counts wins; lose/draw resets)
      v_p_streak := 0;
      IF v_p_result = 'win' THEN
        v_p_streak := 1;
        DECLARE
          v_prev record;
        BEGIN
          FOR v_prev IN
            SELECT result FROM public.rival_battle_rewards
            WHERE user_id = v_player_id
            ORDER BY created_at DESC
          LOOP
            IF v_prev.result = 'win' THEN
              v_p_streak := v_p_streak + 1;
            ELSE
              EXIT;
            END IF;
          END LOOP;
        END;
      END IF;

      v_p_bonus := CASE WHEN v_p_streak >= 3 THEN 50 ELSE 0 END;

      INSERT INTO public.rival_battle_rewards (
        battle_id, user_id, result, coins_earned, exp_earned, win_streak, streak_bonus_coins
      ) VALUES (
        v_battle.id, v_player_id, v_p_result, v_p_coins, v_p_exp, v_p_streak, v_p_bonus
      ) ON CONFLICT DO NOTHING;
    END LOOP;

    v_completed := v_completed + 1;
  END LOOP;

  RETURN jsonb_build_object('completed', v_completed, 'week_start', p_week_start);
END;
$$;

-- ============ claim_rival_reward ============
CREATE OR REPLACE FUNCTION public.claim_rival_reward(p_battle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_reward record;
  v_total_coins int;
  v_total_exp integer;
  v_old_level int;
  v_new_level int;
  v_required int;
  v_cumulative int := 0;
  v_lvl int := 1;
  v_added_coins int := 0;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;

  SELECT * INTO v_reward
  FROM public.rival_battle_rewards
  WHERE battle_id = p_battle_id AND user_id = v_user AND claimed = false
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '受け取れる報酬がありません';
  END IF;

  v_total_coins := v_reward.coins_earned + v_reward.streak_bonus_coins;

  -- Add coins
  INSERT INTO public.user_avatars (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;

  -- Add EXP via log
  INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
  VALUES (v_user, v_reward.exp_earned, 'rival_battle|' || p_battle_id::text, CURRENT_DATE)
  ON CONFLICT DO NOTHING;

  SELECT level INTO v_old_level FROM public.user_avatars WHERE user_id = v_user;
  SELECT COALESCE(SUM(exp_amount),0) INTO v_total_exp FROM public.avatar_exp_logs WHERE user_id = v_user;
  WHILE v_lvl < 999 LOOP
    v_required := 250 + v_lvl * 50;
    EXIT WHEN v_total_exp < v_cumulative + v_required;
    v_cumulative := v_cumulative + v_required;
    v_lvl := v_lvl + 1;
  END LOOP;
  v_new_level := v_lvl;
  v_added_coins := GREATEST(0, v_new_level - COALESCE(v_old_level,1)) * 10;

  UPDATE public.user_avatars
  SET coins = coins + v_total_coins + v_added_coins,
      total_exp = v_total_exp,
      level = v_new_level,
      updated_at = now()
  WHERE user_id = v_user;

  UPDATE public.rival_battle_rewards
  SET claimed = true, claimed_at = now()
  WHERE id = v_reward.id;

  RETURN jsonb_build_object(
    'coins', v_total_coins,
    'exp', v_reward.exp_earned,
    'streak_bonus', v_reward.streak_bonus_coins,
    'win_streak', v_reward.win_streak,
    'leveled_up', v_new_level > COALESCE(v_old_level,1)
  );
END;
$$;
