
-- Weight journey table
CREATE TABLE public.weight_journey (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  start_weight numeric(5,1) NOT NULL,
  target_weight numeric(5,1) NOT NULL,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Allow only one active journey per user
CREATE UNIQUE INDEX weight_journey_active_per_user ON public.weight_journey (user_id) WHERE is_active = true;

ALTER TABLE public.weight_journey ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own journey" ON public.weight_journey
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers insert journey" ON public.weight_journey
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers update journey" ON public.weight_journey
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers delete journey" ON public.weight_journey
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'trainer'::app_role));

-- Milestones table
CREATE TABLE public.weight_journey_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  journey_id uuid NOT NULL REFERENCES public.weight_journey(id) ON DELETE CASCADE,
  milestone_kg numeric(5,1) NOT NULL,
  milestone_type text NOT NULL,
  coins_awarded integer NOT NULL DEFAULT 0,
  badge_key text,
  achieved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, journey_id, milestone_type)
);

ALTER TABLE public.weight_journey_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own journey milestones" ON public.weight_journey_milestones
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- Function for milestone evaluation
CREATE OR REPLACE FUNCTION public.check_weight_milestones(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_journey record;
  v_current_weight numeric;
  v_lost numeric;
  v_total_goal numeric;
  v_milestones jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_journey FROM public.weight_journey
  WHERE user_id = p_user_id AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('granted', '[]'::jsonb);
  END IF;

  SELECT weight INTO v_current_weight FROM public.user_measurements
  WHERE user_id = p_user_id AND weight IS NOT NULL
  ORDER BY measured_date DESC LIMIT 1;

  IF v_current_weight IS NULL THEN
    RETURN jsonb_build_object('granted', '[]'::jsonb);
  END IF;

  v_lost := v_journey.start_weight - v_current_weight;
  v_total_goal := v_journey.start_weight - v_journey.target_weight;

  -- 1kg
  IF v_lost >= 1 THEN
    BEGIN
      INSERT INTO public.weight_journey_milestones (user_id, journey_id, milestone_kg, milestone_type, coins_awarded, badge_key)
      VALUES (p_user_id, v_journey.id, 1, 'first_step', 20, 'weight_first_step');
      UPDATE public.user_avatars SET coins = COALESCE(coins,0) + 20 WHERE user_id = p_user_id;
      INSERT INTO public.avatar_achievements (user_id, achievement_key) VALUES (p_user_id, 'weight_first_step') ON CONFLICT DO NOTHING;
      v_milestones := v_milestones || jsonb_build_object('type','first_step','kg',1,'coins',20,'badge','ファーストステップ');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END IF;

  -- 3kg
  IF v_lost >= 3 THEN
    BEGIN
      INSERT INTO public.weight_journey_milestones (user_id, journey_id, milestone_kg, milestone_type, coins_awarded, badge_key)
      VALUES (p_user_id, v_journey.id, 3, 'change_start', 30, 'weight_change_start');
      UPDATE public.user_avatars SET coins = COALESCE(coins,0) + 30 WHERE user_id = p_user_id;
      INSERT INTO public.avatar_achievements (user_id, achievement_key) VALUES (p_user_id, 'weight_change_start') ON CONFLICT DO NOTHING;
      v_milestones := v_milestones || jsonb_build_object('type','change_start','kg',3,'coins',30,'badge','チェンジ開始');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END IF;

  -- halfway
  IF v_total_goal > 2 AND v_lost >= LEAST(5, v_total_goal / 2) THEN
    BEGIN
      INSERT INTO public.weight_journey_milestones (user_id, journey_id, milestone_kg, milestone_type, coins_awarded, badge_key)
      VALUES (p_user_id, v_journey.id, LEAST(5, v_total_goal / 2), 'halfway', 50, 'weight_halfway');
      UPDATE public.user_avatars SET coins = COALESCE(coins,0) + 50 WHERE user_id = p_user_id;
      INSERT INTO public.avatar_achievements (user_id, achievement_key) VALUES (p_user_id, 'weight_halfway') ON CONFLICT DO NOTHING;
      v_milestones := v_milestones || jsonb_build_object('type','halfway','kg',LEAST(5,v_total_goal/2),'coins',50,'badge','ハーフウェイ');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END IF;

  -- goal
  IF v_current_weight <= v_journey.target_weight THEN
    BEGIN
      INSERT INTO public.weight_journey_milestones (user_id, journey_id, milestone_kg, milestone_type, coins_awarded, badge_key)
      VALUES (p_user_id, v_journey.id, v_total_goal, 'goal', 100, 'weight_goal_achieved');
      UPDATE public.user_avatars SET coins = COALESCE(coins,0) + 100 WHERE user_id = p_user_id;
      INSERT INTO public.avatar_achievements (user_id, achievement_key) VALUES (p_user_id, 'weight_goal_achieved') ON CONFLICT DO NOTHING;
      INSERT INTO public.user_titles (user_id, title_key) VALUES (p_user_id, 'goal_achiever') ON CONFLICT DO NOTHING;
      v_milestones := v_milestones || jsonb_build_object('type','goal','kg',v_total_goal,'coins',100,'badge','ゴール達成','title','ゴール達成者');
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'granted', v_milestones,
    'current_weight', v_current_weight,
    'lost', v_lost,
    'progress', CASE WHEN v_total_goal > 0 THEN ROUND((v_lost / v_total_goal) * 100, 1) ELSE 0 END
  );
END;
$$;
