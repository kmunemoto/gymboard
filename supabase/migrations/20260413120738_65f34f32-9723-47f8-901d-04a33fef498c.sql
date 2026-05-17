-- Add calendar_token column to profiles
ALTER TABLE public.profiles
ADD COLUMN calendar_token uuid DEFAULT gen_random_uuid();

-- Populate existing rows that got NULL
UPDATE public.profiles
SET calendar_token = gen_random_uuid()
WHERE calendar_token IS NULL;

-- Make it NOT NULL after populating
ALTER TABLE public.profiles
ALTER COLUMN calendar_token SET NOT NULL;

-- Add unique index for fast lookup by token
CREATE UNIQUE INDEX idx_profiles_calendar_token ON public.profiles (calendar_token);