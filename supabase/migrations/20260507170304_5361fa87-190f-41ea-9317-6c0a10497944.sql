
-- Allow trainers to insert exp logs for customers (needed when trainer saves missions)
CREATE POLICY "Trainers insert any exp logs" ON public.avatar_exp_logs
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

-- Allow trainers to update customer avatars
CREATE POLICY "Trainers update any avatar" ON public.user_avatars
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers insert any avatar" ON public.user_avatars
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

-- Allow trainers to insert achievements / titles for customers
CREATE POLICY "Trainers insert any achievement" ON public.avatar_achievements
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers insert any title" ON public.user_titles
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

-- Allow customers to update their own equipped_title (already covered via Users update own avatar)

-- Function: process session rewards (session exp + combo + level)
CREATE OR REPLACE FUNCTION public.process_session_rewards(_user_id uuid, _workout_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  -- Ensure session exp log exists for this date
  INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
  VALUES (_user_id, 100, 'session|' || _workout_date::text, _workout_date)
  ON CONFLICT (user_id, reason, reference_date) DO NOTHING;

  -- Ensure avatar row
  INSERT INTO public.user_avatars (user_id) VALUES (_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_avatar FROM public.user_avatars WHERE user_id = _user_id FOR UPDATE;
  v_old_combo := COALESCE(v_avatar.combo_count, 0);
  v_old_level := COALESCE(v_avatar.level, 1);

  -- Compute new combo: same date = unchanged; <=7 days = +1; else reset to 1
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

  -- Sum today's exp logs (session + mission etc.) excluding any existing combo_bonus
  SELECT COALESCE(SUM(exp_amount), 0) INTO v_today_sum
  FROM public.avatar_exp_logs
  WHERE user_id = _user_id
    AND reference_date = _workout_date
    AND reason NOT LIKE 'combo_bonus|%';

  v_combo_bonus := FLOOR(v_today_sum * (v_mult - 1.0))::integer;

  IF v_combo_bonus > 0 THEN
    -- Replace any existing combo_bonus for the date with the new value
    DELETE FROM public.avatar_exp_logs
    WHERE user_id = _user_id AND reference_date = _workout_date AND reason LIKE 'combo_bonus|%';
    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
    VALUES (_user_id, v_combo_bonus, 'combo_bonus|' || _workout_date::text, _workout_date);
  END IF;

  -- Recompute total exp + level
  SELECT COALESCE(SUM(exp_amount), 0) INTO v_total_exp
  FROM public.avatar_exp_logs WHERE user_id = _user_id;

  -- compute level
  WHILE v_lvl < 999 LOOP
    v_required := 250 + v_lvl * 50;
    EXIT WHEN v_total_exp < v_cumulative + v_required;
    v_cumulative := v_cumulative + v_required;
    v_lvl := v_lvl + 1;
  END LOOP;
  v_new_level := v_lvl;
  v_added_coins := GREATEST(0, v_new_level - v_old_level) * 10;

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

  RETURN jsonb_build_object(
    'combo', v_new_combo,
    'multiplier', v_mult,
    'combo_bonus', v_combo_bonus,
    'total_exp', v_total_exp,
    'level', v_new_level,
    'leveled_up', v_new_level > v_old_level
  );
END;
$$;

-- Add unique constraint on user_avatars(user_id) so ON CONFLICT works
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_avatars_user_id_key') THEN
    ALTER TABLE public.user_avatars ADD CONSTRAINT user_avatars_user_id_key UNIQUE (user_id);
  END IF;
END $$;
