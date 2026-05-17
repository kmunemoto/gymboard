
-- user_gacha_tickets table: 1 ticket per training session (user_id + workout_date)
CREATE TABLE IF NOT EXISTS public.user_gacha_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_date date NOT NULL,
  used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_date)
);

CREATE INDEX IF NOT EXISTS idx_user_gacha_tickets_user_unused
  ON public.user_gacha_tickets (user_id, used, created_at);

ALTER TABLE public.user_gacha_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own tickets"
  ON public.user_gacha_tickets FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- INSERT only via SECURITY DEFINER trigger / RPC; block direct authenticated inserts
-- (no INSERT policy created for authenticated)

-- Add ticket_id to gacha_results, drop daily-unique constraint
ALTER TABLE public.gacha_results
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.user_gacha_tickets(id) ON DELETE SET NULL;

ALTER TABLE public.gacha_results
  DROP CONSTRAINT IF EXISTS gacha_results_user_id_result_date_key;

-- Trigger: grant a ticket on first workout of a (user, date)
CREATE OR REPLACE FUNCTION public.grant_gacha_ticket_on_workout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_gacha_tickets (user_id, session_date)
  VALUES (NEW.user_id, NEW.workout_date)
  ON CONFLICT (user_id, session_date) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_gacha_ticket ON public.workouts;
CREATE TRIGGER trg_grant_gacha_ticket
AFTER INSERT ON public.workouts
FOR EACH ROW EXECUTE FUNCTION public.grant_gacha_ticket_on_workout();

-- Backfill from existing workouts
INSERT INTO public.user_gacha_tickets (user_id, session_date, used, created_at)
SELECT user_id, workout_date, false, MIN(created_at)
FROM public.workouts
GROUP BY user_id, workout_date
ON CONFLICT (user_id, session_date) DO NOTHING;

-- New spin_gacha RPC: consumes oldest unused ticket
CREATE OR REPLACE FUNCTION public.spin_gacha(_user_id uuid, _result_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  v_roll := floor(random() * 100)::int;
  IF v_roll < 60 THEN v_rarity := 'common';
  ELSIF v_roll < 85 THEN v_rarity := 'rare';
  ELSIF v_roll < 97 THEN v_rarity := 'epic';
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
$$;
