
-- 1. raid_bosses
CREATE TABLE public.raid_bosses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boss_name text NOT NULL,
  boss_hp integer NOT NULL,
  current_damage integer NOT NULL DEFAULT 0,
  start_date date NOT NULL,
  end_date date NOT NULL,
  defeated boolean NOT NULL DEFAULT false,
  defeated_at timestamptz,
  boss_image_url text,
  reward_exp integer NOT NULL DEFAULT 300,
  reward_coins integer NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.raid_bosses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view raids" ON public.raid_bosses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Trainers manage raids insert" ON public.raid_bosses FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Trainers manage raids update" ON public.raid_bosses FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Trainers manage raids delete" ON public.raid_bosses FOR DELETE TO authenticated USING (has_role(auth.uid(), 'trainer'::app_role));
-- Allow service_role-like updates for damage from authenticated users via direct UPDATE: we restrict to trainers only.
-- Damage updates will be done via SECURITY DEFINER function.

-- 2. raid_damage_logs
CREATE TABLE public.raid_damage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_id uuid NOT NULL REFERENCES public.raid_bosses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  damage integer NOT NULL,
  workout_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raid_id, user_id, workout_date)
);
ALTER TABLE public.raid_damage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view damage logs" ON public.raid_damage_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own damage" ON public.raid_damage_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users update own damage" ON public.raid_damage_logs FOR UPDATE TO authenticated USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- 3. user_titles
CREATE TABLE public.user_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title_key text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, title_key)
);
ALTER TABLE public.user_titles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own titles" ON public.user_titles FOR SELECT TO authenticated USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own titles" ON public.user_titles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 4. user_avatars additions
ALTER TABLE public.user_avatars
  ADD COLUMN combo_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_session_date date,
  ADD COLUMN max_combo_reached integer NOT NULL DEFAULT 0,
  ADD COLUMN combo_5_count integer NOT NULL DEFAULT 0,
  ADD COLUMN equipped_title text;

-- 5. SECURITY DEFINER function: apply raid damage and distribute rewards if defeated
CREATE OR REPLACE FUNCTION public.apply_raid_damage(_user_id uuid, _workout_date date, _damage integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_raid record;
  v_already integer;
  v_added integer := 0;
  v_defeated boolean := false;
  v_participant uuid;
BEGIN
  IF _damage IS NULL OR _damage <= 0 THEN
    RETURN jsonb_build_object('applied', 0);
  END IF;

  SELECT * INTO v_raid FROM public.raid_bosses
  WHERE defeated = false
    AND _workout_date BETWEEN start_date AND end_date
  ORDER BY start_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', 0);
  END IF;

  -- Existing damage for this user/date
  SELECT damage INTO v_already FROM public.raid_damage_logs
  WHERE raid_id = v_raid.id AND user_id = _user_id AND workout_date = _workout_date;

  IF v_already IS NULL THEN
    INSERT INTO public.raid_damage_logs (raid_id, user_id, damage, workout_date)
    VALUES (v_raid.id, _user_id, _damage, _workout_date);
    v_added := _damage;
  ELSIF _damage > v_already THEN
    v_added := _damage - v_already;
    UPDATE public.raid_damage_logs SET damage = _damage
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
      -- Reward all participants
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

  RETURN jsonb_build_object('applied', v_added, 'defeated', v_defeated, 'raid_id', v_raid.id);
END;
$$;

-- Avatar_exp_logs unique index used by ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS avatar_exp_logs_unique_user_reason_date
  ON public.avatar_exp_logs (user_id, reason, COALESCE(reference_date, '1970-01-01'::date));

-- 6. Initial bosses
INSERT INTO public.raid_bosses (boss_name, boss_hp, start_date, end_date, reward_exp, reward_coins) VALUES
('ゴブリン', 200000, '2026-05-19', '2026-05-25', 200, 20),
('オーク戦士', 350000, '2026-06-15', '2026-06-21', 300, 30),
('ドラゴン', 500000, '2026-07-14', '2026-07-20', 500, 50);
