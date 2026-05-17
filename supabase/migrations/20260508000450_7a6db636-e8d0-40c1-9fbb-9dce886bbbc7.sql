
-- 1) Rank-up rewards log
CREATE TABLE public.avatar_rank_up_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rank_name text NOT NULL,
  coins_awarded integer NOT NULL DEFAULT 0,
  tickets_awarded integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, rank_name)
);

ALTER TABLE public.avatar_rank_up_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own rank up rewards"
ON public.avatar_rank_up_rewards FOR SELECT TO authenticated
USING ((auth.uid() = user_id) OR has_role(auth.uid(), 'trainer'::app_role));

-- 2) Allow bonus tickets without a session_date
ALTER TABLE public.user_gacha_tickets
  ALTER COLUMN session_date DROP NOT NULL;

-- Replace the (user_id, session_date) UNIQUE with a partial index that only enforces
-- uniqueness when session_date IS NOT NULL (so bonus tickets with NULL aren't blocked).
ALTER TABLE public.user_gacha_tickets
  DROP CONSTRAINT IF EXISTS user_gacha_tickets_user_id_session_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS user_gacha_tickets_user_session_date_uniq
  ON public.user_gacha_tickets (user_id, session_date)
  WHERE session_date IS NOT NULL;

-- 3) Update apply_raid_damage to apply rank multiplier
CREATE OR REPLACE FUNCTION public.apply_raid_damage(_user_id uuid, _workout_date date, _damage integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_raid record;
  v_already integer;
  v_added integer := 0;
  v_defeated boolean := false;
  v_participant uuid;
  v_level integer;
  v_mult numeric;
  v_final_damage integer;
BEGIN
  IF _damage IS NULL OR _damage <= 0 THEN
    RETURN jsonb_build_object('applied', 0);
  END IF;

  SELECT COALESCE(level, 1) INTO v_level FROM public.user_avatars WHERE user_id = _user_id;
  v_level := COALESCE(v_level, 1);
  v_mult := CASE
    WHEN v_level <= 5 THEN 1.0
    WHEN v_level <= 15 THEN 1.2
    WHEN v_level <= 30 THEN 1.5
    WHEN v_level <= 50 THEN 1.8
    ELSE 2.0
  END;
  v_final_damage := FLOOR(_damage * v_mult)::int;

  SELECT * INTO v_raid FROM public.raid_bosses
  WHERE defeated = false
    AND _workout_date BETWEEN start_date AND end_date
  ORDER BY start_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', 0);
  END IF;

  SELECT damage INTO v_already FROM public.raid_damage_logs
  WHERE raid_id = v_raid.id AND user_id = _user_id AND workout_date = _workout_date;

  IF v_already IS NULL THEN
    INSERT INTO public.raid_damage_logs (raid_id, user_id, damage, workout_date)
    VALUES (v_raid.id, _user_id, v_final_damage, _workout_date);
    v_added := v_final_damage;
  ELSIF v_final_damage > v_already THEN
    v_added := v_final_damage - v_already;
    UPDATE public.raid_damage_logs SET damage = v_final_damage
    WHERE raid_id = v_raid.id AND user_id = _user_id AND workout_date = _workout_date;
  END IF;

  IF v_added > 0 THEN
    UPDATE public.raid_bosses
    SET current_damage = current_damage + v_added,
        defeated = (current_damage + v_added) >= boss_hp,
        defeated_at = CASE WHEN (current_damage + v_added) >= boss_hp AND defeated_at IS NULL THEN now() ELSE defeated_at END
    WHERE id = v_raid.id
    RETURNING defeated INTO v_defeated;

    IF v_defeated THEN
      FOR v_participant IN
        SELECT DISTINCT user_id FROM public.raid_damage_logs WHERE raid_id = v_raid.id
      LOOP
        INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
        VALUES (v_participant, v_raid.reward_exp, 'raid_reward|' || v_raid.id::text, CURRENT_DATE)
        ON CONFLICT (user_id, reason, reference_date) DO NOTHING;

        UPDATE public.user_avatars
        SET total_exp = total_exp + v_raid.reward_exp,
            coins = coins + v_raid.reward_coins
        WHERE user_id = v_participant;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('applied', v_added, 'defeated', v_defeated, 'raid_id', v_raid.id, 'multiplier', v_mult);
END;
$function$;

-- 4) Update spin_gacha to use rank-based probability
CREATE OR REPLACE FUNCTION public.spin_gacha(_user_id uuid, _result_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket record;
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
  v_remaining integer;
  v_user_level integer;
  v_pc integer; v_pr integer; v_pe integer; -- thresholds
BEGIN
  IF auth.uid() IS DISTINCT FROM _user_id AND NOT has_role(auth.uid(), 'trainer'::app_role) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_ticket FROM public.user_gacha_tickets
  WHERE user_id = _user_id AND used = false
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('no_ticket', true, 'remaining', 0);
  END IF;

  SELECT COALESCE(level, 1) INTO v_user_level FROM public.user_avatars WHERE user_id = _user_id;
  v_user_level := COALESCE(v_user_level, 1);

  -- Probability cumulative thresholds: [common, rare, epic, legendary]
  -- (cumulative % out of 100): v_pc = common upper, v_pr = rare upper, v_pe = epic upper
  IF v_user_level <= 5 THEN
    v_pc := 60; v_pr := 85; v_pe := 97; -- legendary 3%
  ELSIF v_user_level <= 15 THEN
    v_pc := 57; v_pr := 82; v_pe := 96; -- legendary 4%
  ELSIF v_user_level <= 30 THEN
    v_pc := 53; v_pr := 78; v_pe := 95; -- legendary 5%
  ELSIF v_user_level <= 50 THEN
    v_pc := 49; v_pr := 74; v_pe := 94; -- legendary 6%
  ELSE
    v_pc := 42; v_pr := 67; v_pe := 92; -- legendary 8%
  END IF;

  v_roll := floor(random() * 100)::int;
  IF v_roll < v_pc THEN v_rarity := 'common';
  ELSIF v_roll < v_pr THEN v_rarity := 'rare';
  ELSIF v_roll < v_pe THEN v_rarity := 'epic';
  ELSE v_rarity := 'legendary';
  END IF;

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

  UPDATE public.user_gacha_tickets
  SET used = true, used_at = now()
  WHERE id = v_ticket.id;

  INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_amount, rarity, ticket_id)
  VALUES (_user_id, _result_date, v_reward->>'type', (v_reward->>'amount')::int, v_rarity, v_ticket.id);

  INSERT INTO public.user_avatars (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

  IF v_reward->>'type' = 'coins' THEN
    UPDATE public.user_avatars SET coins = coins + (v_reward->>'amount')::int, updated_at = now()
    WHERE user_id = _user_id;
  ELSE
    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
    VALUES (_user_id, (v_reward->>'amount')::int, 'gacha|' || v_ticket.id::text, _result_date);

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

  SELECT COUNT(*) INTO v_remaining FROM public.user_gacha_tickets
  WHERE user_id = _user_id AND used = false;

  RETURN jsonb_build_object(
    'no_ticket', false,
    'reward_type', v_reward->>'type',
    'reward_amount', (v_reward->>'amount')::int,
    'rarity', v_rarity,
    'remaining', v_remaining
  );
END;
$function$;

-- 5) Update process_session_rewards to award rank-up bonuses
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
BEGIN
  INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
  VALUES (_user_id, 100, 'session|' || _workout_date::text, _workout_date)
  ON CONFLICT (user_id, reason, reference_date) DO NOTHING;

  INSERT INTO public.user_avatars (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

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

  -- Determine rank labels (rookie/regular/athlete/elite/legend)
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

  -- Rank-up bonus (one-time per rank)
  IF v_new_rank IS DISTINCT FROM v_old_rank AND v_new_rank IN ('regular','athlete','elite','legend') THEN
    v_rank_coins := CASE v_new_rank
      WHEN 'regular' THEN 30
      WHEN 'athlete' THEN 50
      WHEN 'elite' THEN 100
      WHEN 'legend' THEN 200
    END;
    v_rank_tickets := CASE v_new_rank
      WHEN 'regular' THEN 2
      WHEN 'athlete' THEN 3
      WHEN 'elite' THEN 5
      WHEN 'legend' THEN 10
    END;

    -- Try to insert; ignore if already given
    BEGIN
      INSERT INTO public.avatar_rank_up_rewards (user_id, rank_name, coins_awarded, tickets_awarded)
      VALUES (_user_id, v_new_rank, v_rank_coins, v_rank_tickets);

      UPDATE public.user_avatars SET coins = coins + v_rank_coins WHERE user_id = _user_id;

      v_i := 0;
      WHILE v_i < v_rank_tickets LOOP
        INSERT INTO public.user_gacha_tickets (user_id, session_date)
        VALUES (_user_id, NULL);
        v_i := v_i + 1;
      END LOOP;

      v_rank_up := jsonb_build_object(
        'rank', v_new_rank,
        'coins', v_rank_coins,
        'tickets', v_rank_tickets
      );
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
    'rank_up', v_rank_up
  );
END;
$function$;
