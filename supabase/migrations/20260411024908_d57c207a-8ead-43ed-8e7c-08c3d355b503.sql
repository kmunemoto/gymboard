ALTER TABLE public.profiles ADD COLUMN line_user_id text;

CREATE INDEX idx_profiles_line_user_id ON public.profiles (line_user_id) WHERE line_user_id IS NOT NULL;