
-- user_avatars
CREATE TABLE public.user_avatars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  total_exp integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 1,
  coins integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_avatars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own avatar" ON public.user_avatars
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own avatar" ON public.user_avatars
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own avatar" ON public.user_avatars
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_user_avatars_updated_at BEFORE UPDATE ON public.user_avatars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- avatar_exp_logs
CREATE TABLE public.avatar_exp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  exp_amount integer NOT NULL,
  reason text NOT NULL,
  reference_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, reason, reference_date)
);

CREATE INDEX idx_avatar_exp_logs_user_created ON public.avatar_exp_logs(user_id, created_at DESC);

ALTER TABLE public.avatar_exp_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own exp logs" ON public.avatar_exp_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own exp logs" ON public.avatar_exp_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- avatar_achievements
CREATE TABLE public.avatar_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  achievement_key text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_key)
);

ALTER TABLE public.avatar_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own achievements" ON public.avatar_achievements
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own achievements" ON public.avatar_achievements
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
