ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS best_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_streak_notified integer NOT NULL DEFAULT 0;