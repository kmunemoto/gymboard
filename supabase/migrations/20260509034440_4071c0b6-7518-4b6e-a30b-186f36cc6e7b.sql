
-- =====================================================================
-- LOGIN BONUS + SEASON PASS SYSTEM
-- =====================================================================

-- ---------- daily_login_bonuses ----------
CREATE TABLE public.daily_login_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  login_date date NOT NULL,
  day_number int NOT NULL,
  reward_type text NOT NULL,
  reward_amount int NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, login_date)
);
ALTER TABLE public.daily_login_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own login bonuses" ON public.daily_login_bonuses
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own login bonuses" ON public.daily_login_bonuses
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ---------- season_pass_config ----------
CREATE TABLE public.season_pass_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month text UNIQUE NOT NULL,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  premium_cost_coins int NOT NULL DEFAULT 500,
  premium_exp_multiplier numeric NOT NULL DEFAULT 1.5,
  premium_daily_coins int NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.season_pass_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed reads season config" ON public.season_pass_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Trainers manage season config" ON public.season_pass_config
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'trainer'::app_role))
  WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

-- ---------- season_pass_levels ----------
CREATE TABLE public.season_pass_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id uuid NOT NULL REFERENCES public.season_pass_config(id) ON DELETE CASCADE,
  level int NOT NULL,
  required_points int NOT NULL,
  free_reward_type text,
  free_reward_key text,
  free_reward_amount int NOT NULL DEFAULT 0,
  premium_reward_type text,
  premium_reward_key text,
  premium_reward_amount int NOT NULL DEFAULT 0,
  UNIQUE(config_id, level)
);
ALTER TABLE public.season_pass_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed reads season levels" ON public.season_pass_levels
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Trainers manage season levels" ON public.season_pass_levels
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'trainer'::app_role))
  WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

-- ---------- user_season_pass ----------
CREATE TABLE public.user_season_pass (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  config_id uuid NOT NULL REFERENCES public.season_pass_config(id) ON DELETE CASCADE,
  is_premium boolean NOT NULL DEFAULT false,
  premium_purchased_at timestamptz,
  current_points int NOT NULL DEFAULT 0,
  current_level int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, config_id)
);
ALTER TABLE public.user_season_pass ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own pass" ON public.user_season_pass
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own pass" ON public.user_season_pass
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own pass" ON public.user_season_pass
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- ---------- user_season_pass_claims ----------
CREATE TABLE public.user_season_pass_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  config_id uuid NOT NULL REFERENCES public.season_pass_config(id) ON DELETE CASCADE,
  level int NOT NULL,
  track text NOT NULL CHECK (track IN ('free','premium')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, config_id, level, track)
);
ALTER TABLE public.user_season_pass_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own claims" ON public.user_season_pass_claims
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own claims" ON public.user_season_pass_claims
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- =====================================================================
-- RPC FUNCTIONS
-- =====================================================================

-- Helper: get current month config (by JST today)
CREATE OR REPLACE FUNCTION public.get_current_season_config()
RETURNS public.season_pass_config
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.season_pass_config
  WHERE (now() AT TIME ZONE 'Asia/Tokyo')::date BETWEEN start_date AND end_date
  ORDER BY start_date DESC LIMIT 1;
$$;

-- add_season_pass_points
CREATE OR REPLACE FUNCTION public.add_season_pass_points(
  p_user_id uuid, p_points int, p_action text DEFAULT 'unknown'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.season_pass_config;
  v_pass public.user_season_pass;
  v_new_level int;
  v_old_level int;
BEGIN
  SELECT * INTO v_cfg FROM public.get_current_season_config();
  IF v_cfg.id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'no_active_pass');
  END IF;

  INSERT INTO public.user_season_pass(user_id, config_id, current_points, current_level)
  VALUES (p_user_id, v_cfg.id, 0, 0)
  ON CONFLICT (user_id, config_id) DO NOTHING;

  SELECT * INTO v_pass FROM public.user_season_pass
    WHERE user_id = p_user_id AND config_id = v_cfg.id;

  v_old_level := v_pass.current_level;
  v_pass.current_points := v_pass.current_points + GREATEST(p_points, 0);

  SELECT COALESCE(MAX(level), 0) INTO v_new_level
    FROM public.season_pass_levels
    WHERE config_id = v_cfg.id AND required_points <= v_pass.current_points;

  UPDATE public.user_season_pass
    SET current_points = v_pass.current_points,
        current_level = v_new_level,
        updated_at = now()
    WHERE id = v_pass.id;

  RETURN jsonb_build_object(
    'new_points', v_pass.current_points,
    'new_level', v_new_level,
    'level_up', v_new_level > v_old_level,
    'action', p_action
  );
END;
$$;

-- claim_daily_login_bonus
CREATE OR REPLACE FUNCTION public.claim_daily_login_bonus(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_yesterday date := v_today - 1;
  v_existing public.daily_login_bonuses;
  v_prev public.daily_login_bonuses;
  v_day_number int;
  v_streak_reset boolean := false;
  v_reward_type text;
  v_reward_amount int;
  v_cfg public.season_pass_config;
  v_pass public.user_season_pass;
  v_extra_coins int := 0;
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
    -- streak reset only if user had logged in before
    IF EXISTS (SELECT 1 FROM public.daily_login_bonuses WHERE user_id = p_user_id) THEN
      v_streak_reset := true;
    END IF;
  END IF;

  -- reward table
  CASE v_day_number
    WHEN 1 THEN v_reward_type := 'coins';        v_reward_amount := 5;
    WHEN 2 THEN v_reward_type := 'exp';          v_reward_amount := 20;
    WHEN 3 THEN v_reward_type := 'coins';        v_reward_amount := 10;
    WHEN 4 THEN v_reward_type := 'exp';          v_reward_amount := 30;
    WHEN 5 THEN v_reward_type := 'coins';        v_reward_amount := 15;
    WHEN 6 THEN v_reward_type := 'exp';          v_reward_amount := 50;
    WHEN 7 THEN v_reward_type := 'gacha_ticket'; v_reward_amount := 1;
  END CASE;

  -- premium daily coin bonus
  SELECT * INTO v_cfg FROM public.get_current_season_config();
  IF v_cfg.id IS NOT NULL THEN
    SELECT * INTO v_pass FROM public.user_season_pass
      WHERE user_id = p_user_id AND config_id = v_cfg.id;
    IF FOUND AND v_pass.is_premium THEN
      v_extra_coins := v_cfg.premium_daily_coins;
    END IF;
  END IF;

  INSERT INTO public.daily_login_bonuses(user_id, login_date, day_number, reward_type, reward_amount)
  VALUES (p_user_id, v_today, v_day_number, v_reward_type, v_reward_amount);

  -- grant
  IF v_reward_type = 'coins' THEN
    UPDATE public.user_avatars SET coins = coins + v_reward_amount + v_extra_coins, updated_at = now()
      WHERE user_id = p_user_id;
  ELSIF v_reward_type = 'exp' THEN
    INSERT INTO public.avatar_exp_logs(user_id, exp_amount, reason, reference_date)
    VALUES (p_user_id, v_reward_amount, 'login_bonus', v_today);
    IF v_extra_coins > 0 THEN
      UPDATE public.user_avatars SET coins = coins + v_extra_coins, updated_at = now()
        WHERE user_id = p_user_id;
    END IF;
  ELSIF v_reward_type = 'gacha_ticket' THEN
    INSERT INTO public.user_gacha_tickets(user_id) VALUES (p_user_id);
    IF v_extra_coins > 0 THEN
      UPDATE public.user_avatars SET coins = coins + v_extra_coins, updated_at = now()
        WHERE user_id = p_user_id;
    END IF;
  END IF;

  -- season pass points
  PERFORM public.add_season_pass_points(p_user_id, 10, 'login_bonus');

  RETURN jsonb_build_object(
    'already_claimed', false,
    'day_number', v_day_number,
    'reward_type', v_reward_type,
    'reward_amount', v_reward_amount,
    'extra_coins', v_extra_coins,
    'streak_reset', v_streak_reset
  );
END;
$$;

-- get_login_bonus_status
CREATE OR REPLACE FUNCTION public.get_login_bonus_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_yesterday date := v_today - 1;
  v_today_row public.daily_login_bonuses;
  v_prev public.daily_login_bonuses;
  v_current_day int;
  v_claimed_today boolean;
  v_calendar jsonb := '[]'::jsonb;
  v_recent jsonb;
BEGIN
  SELECT * INTO v_today_row FROM public.daily_login_bonuses
    WHERE user_id = p_user_id AND login_date = v_today;
  v_claimed_today := FOUND;

  IF v_claimed_today THEN
    v_current_day := v_today_row.day_number;
  ELSE
    SELECT * INTO v_prev FROM public.daily_login_bonuses
      WHERE user_id = p_user_id AND login_date = v_yesterday;
    IF FOUND THEN
      v_current_day := v_prev.day_number + 1;
      IF v_current_day > 7 THEN v_current_day := 1; END IF;
    ELSE
      v_current_day := 1;
    END IF;
  END IF;

  -- last 7 records to determine which days in cycle were claimed (just last 7 entries' day_numbers)
  SELECT jsonb_agg(jsonb_build_object('login_date', login_date, 'day_number', day_number) ORDER BY login_date DESC)
    INTO v_recent
    FROM (
      SELECT login_date, day_number FROM public.daily_login_bonuses
        WHERE user_id = p_user_id ORDER BY login_date DESC LIMIT 7
    ) s;

  RETURN jsonb_build_object(
    'today', v_today,
    'claimed_today', v_claimed_today,
    'current_day_number', v_current_day,
    'today_reward_type', CASE v_current_day
      WHEN 1 THEN 'coins' WHEN 2 THEN 'exp' WHEN 3 THEN 'coins'
      WHEN 4 THEN 'exp' WHEN 5 THEN 'coins' WHEN 6 THEN 'exp'
      WHEN 7 THEN 'gacha_ticket' END,
    'today_reward_amount', CASE v_current_day
      WHEN 1 THEN 5 WHEN 2 THEN 20 WHEN 3 THEN 10
      WHEN 4 THEN 30 WHEN 5 THEN 15 WHEN 6 THEN 50
      WHEN 7 THEN 1 END,
    'recent', COALESCE(v_recent, '[]'::jsonb)
  );
END;
$$;

-- claim_season_pass_reward
CREATE OR REPLACE FUNCTION public.claim_season_pass_reward(
  p_user_id uuid, p_level int, p_track text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.season_pass_config;
  v_pass public.user_season_pass;
  v_lv public.season_pass_levels;
  v_type text; v_key text; v_amount int;
BEGIN
  IF p_track NOT IN ('free','premium') THEN
    RAISE EXCEPTION 'invalid track';
  END IF;
  SELECT * INTO v_cfg FROM public.get_current_season_config();
  IF v_cfg.id IS NULL THEN RAISE EXCEPTION 'no active pass'; END IF;

  SELECT * INTO v_pass FROM public.user_season_pass
    WHERE user_id = p_user_id AND config_id = v_cfg.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no pass progress'; END IF;
  IF v_pass.current_level < p_level THEN RAISE EXCEPTION 'level not reached'; END IF;
  IF p_track = 'premium' AND NOT v_pass.is_premium THEN
    RAISE EXCEPTION 'premium required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_season_pass_claims
             WHERE user_id = p_user_id AND config_id = v_cfg.id
               AND level = p_level AND track = p_track) THEN
    RAISE EXCEPTION 'already claimed';
  END IF;

  SELECT * INTO v_lv FROM public.season_pass_levels
    WHERE config_id = v_cfg.id AND level = p_level;
  IF NOT FOUND THEN RAISE EXCEPTION 'level not configured'; END IF;

  IF p_track = 'free' THEN
    v_type := v_lv.free_reward_type; v_key := v_lv.free_reward_key; v_amount := v_lv.free_reward_amount;
  ELSE
    v_type := v_lv.premium_reward_type; v_key := v_lv.premium_reward_key; v_amount := v_lv.premium_reward_amount;
  END IF;

  -- grant
  IF v_type = 'coins' THEN
    UPDATE public.user_avatars SET coins = coins + v_amount, updated_at = now() WHERE user_id = p_user_id;
  ELSIF v_type = 'exp' THEN
    INSERT INTO public.avatar_exp_logs(user_id, exp_amount, reason)
    VALUES (p_user_id, v_amount, 'season_pass');
  ELSIF v_type = 'gacha_ticket' THEN
    FOR i IN 1..GREATEST(v_amount,1) LOOP
      INSERT INTO public.user_gacha_tickets(user_id) VALUES (p_user_id);
    END LOOP;
  ELSIF v_type = 'title' THEN
    -- store as achievement so it appears as title
    INSERT INTO public.avatar_achievements(user_id, achievement_key)
    VALUES (p_user_id, COALESCE(v_key, 'season_pass_title'))
    ON CONFLICT DO NOTHING;
  ELSIF v_type = 'badge' THEN
    INSERT INTO public.avatar_achievements(user_id, achievement_key)
    VALUES (p_user_id, COALESCE(v_key, 'season_pass_badge'))
    ON CONFLICT DO NOTHING;
  ELSIF v_type = 'frame' THEN
    INSERT INTO public.avatar_achievements(user_id, achievement_key)
    VALUES (p_user_id, COALESCE(v_key, 'season_pass_frame'))
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.user_season_pass_claims(user_id, config_id, level, track)
  VALUES (p_user_id, v_cfg.id, p_level, p_track);

  RETURN jsonb_build_object('reward_type', v_type, 'reward_key', v_key, 'reward_amount', v_amount);
END;
$$;

-- purchase_premium_pass
CREATE OR REPLACE FUNCTION public.purchase_premium_pass(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.season_pass_config;
  v_pass public.user_season_pass;
  v_coins int;
BEGIN
  SELECT * INTO v_cfg FROM public.get_current_season_config();
  IF v_cfg.id IS NULL THEN RAISE EXCEPTION 'no active pass'; END IF;

  INSERT INTO public.user_season_pass(user_id, config_id)
  VALUES (p_user_id, v_cfg.id)
  ON CONFLICT (user_id, config_id) DO NOTHING;

  SELECT * INTO v_pass FROM public.user_season_pass
    WHERE user_id = p_user_id AND config_id = v_cfg.id;
  IF v_pass.is_premium THEN RAISE EXCEPTION 'already premium'; END IF;

  SELECT coins INTO v_coins FROM public.user_avatars WHERE user_id = p_user_id;
  IF COALESCE(v_coins, 0) < v_cfg.premium_cost_coins THEN
    RAISE EXCEPTION 'コインが不足しています';
  END IF;

  UPDATE public.user_avatars SET coins = coins - v_cfg.premium_cost_coins, updated_at = now()
    WHERE user_id = p_user_id;
  UPDATE public.user_season_pass
    SET is_premium = true, premium_purchased_at = now(), updated_at = now()
    WHERE id = v_pass.id;

  RETURN jsonb_build_object('is_premium', true, 'cost', v_cfg.premium_cost_coins);
END;
$$;

-- =====================================================================
-- Premium EXP multiplier trigger (1.5x for premium users)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.apply_premium_exp_multiplier()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg public.season_pass_config;
  v_pass public.user_season_pass;
BEGIN
  IF NEW.reason = 'season_pass' THEN
    RETURN NEW; -- don't multiply pass-issued EXP
  END IF;
  SELECT * INTO v_cfg FROM public.get_current_season_config();
  IF v_cfg.id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_pass FROM public.user_season_pass
    WHERE user_id = NEW.user_id AND config_id = v_cfg.id;
  IF FOUND AND v_pass.is_premium THEN
    NEW.exp_amount := FLOOR(NEW.exp_amount * v_cfg.premium_exp_multiplier);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_premium_exp_multiplier
  BEFORE INSERT ON public.avatar_exp_logs
  FOR EACH ROW EXECUTE FUNCTION public.apply_premium_exp_multiplier();

-- =====================================================================
-- INITIAL DATA: 5月パス
-- =====================================================================
DO $$
DECLARE
  v_cfg_id uuid;
BEGIN
  INSERT INTO public.season_pass_config(month, name, start_date, end_date, premium_cost_coins, premium_exp_multiplier, premium_daily_coins)
  VALUES ('2026-05', '5月パス：パワーアップシーズン', '2026-05-01', '2026-05-31', 500, 1.5, 5)
  RETURNING id INTO v_cfg_id;

  INSERT INTO public.season_pass_levels(config_id, level, required_points, free_reward_type, free_reward_amount, premium_reward_type, premium_reward_amount, premium_reward_key) VALUES
  (v_cfg_id, 1, 30,    'coins', 5,  'coins', 10, NULL),
  (v_cfg_id, 2, 70,    'exp', 20,   'exp', 20, NULL),
  (v_cfg_id, 3, 120,   'coins', 5,  'coins', 15, NULL),
  (v_cfg_id, 4, 180,   'exp', 15,   'exp', 30, NULL),
  (v_cfg_id, 5, 250,   'coins', 10, 'coins', 20, NULL),
  (v_cfg_id, 6, 330,   'exp', 20,   'exp', 40, NULL),
  (v_cfg_id, 7, 420,   'coins', 10, 'coins', 25, NULL),
  (v_cfg_id, 8, 520,   'exp', 25,   'exp', 50, NULL),
  (v_cfg_id, 9, 630,   'coins', 15, 'coins', 30, NULL),
  (v_cfg_id, 10, 750,  'gacha_ticket', 1, 'title', 1, 'pass_holder'),
  (v_cfg_id, 11, 880,  'coins', 20, 'coins', 35, NULL),
  (v_cfg_id, 12, 1020, 'exp', 30,   'exp', 60, NULL),
  (v_cfg_id, 13, 1170, 'coins', 15, 'coins', 30, NULL),
  (v_cfg_id, 14, 1330, 'exp', 35,   'exp', 70, NULL),
  (v_cfg_id, 15, 1500, 'coins', 20, 'coins', 50, NULL),
  (v_cfg_id, 16, 1680, 'exp', 40,   'exp', 80, NULL),
  (v_cfg_id, 17, 1870, 'coins', 20, 'coins', 40, NULL),
  (v_cfg_id, 18, 2070, 'exp', 50,   'exp', 100, NULL),
  (v_cfg_id, 19, 2280, 'coins', 25, 'coins', 50, NULL),
  (v_cfg_id, 20, 2500, 'gacha_ticket', 2, 'badge', 1, 'season_master'),
  (v_cfg_id, 21, 2730, 'coins', 30, 'coins', 50, NULL),
  (v_cfg_id, 22, 2970, 'exp', 60,   'exp', 120, NULL),
  (v_cfg_id, 23, 3220, 'coins', 30, 'coins', 60, NULL),
  (v_cfg_id, 24, 3480, 'exp', 70,   'exp', 140, NULL),
  (v_cfg_id, 25, 3750, 'coins', 40, 'coins', 80, NULL),
  (v_cfg_id, 26, 4030, 'exp', 80,   'exp', 150, NULL),
  (v_cfg_id, 27, 4320, 'coins', 40, 'coins', 80, NULL),
  (v_cfg_id, 28, 4620, 'exp', 100,  'exp', 200, NULL),
  (v_cfg_id, 29, 4930, 'coins', 50, 'coins', 100, NULL),
  (v_cfg_id, 30, 5250, 'gacha_ticket', 3, 'frame', 1, 'season_champion');
END $$;
