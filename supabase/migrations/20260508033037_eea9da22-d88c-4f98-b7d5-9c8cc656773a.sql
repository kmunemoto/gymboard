ALTER TABLE public.user_avatars
  ADD COLUMN IF NOT EXISTS gender text NOT NULL DEFAULT 'female',
  ADD COLUMN IF NOT EXISTS hair_color text NOT NULL DEFAULT 'orange';

ALTER TABLE public.user_avatars
  DROP CONSTRAINT IF EXISTS user_avatars_gender_check;
ALTER TABLE public.user_avatars
  ADD CONSTRAINT user_avatars_gender_check CHECK (gender IN ('male', 'female'));

UPDATE public.user_avatars SET gender = 'female' WHERE gender IS NULL;
UPDATE public.user_avatars SET hair_color = 'orange' WHERE hair_color IS NULL;