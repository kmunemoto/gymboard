CREATE TABLE public.daily_missions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  mission_date date NOT NULL,
  mission_keys text[] NOT NULL,
  completed_keys text[] NOT NULL DEFAULT '{}',
  all_completed boolean NOT NULL DEFAULT false,
  exp_earned integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, mission_date)
);

CREATE INDEX idx_daily_missions_user_date ON public.daily_missions(user_id, mission_date DESC);

ALTER TABLE public.daily_missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own daily missions" ON public.daily_missions
  FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR public.has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users insert own daily missions" ON public.daily_missions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own daily missions" ON public.daily_missions
  FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id) OR public.has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers insert any daily missions" ON public.daily_missions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role));