-- Add sets JSONB column to workouts
ALTER TABLE public.workouts ADD COLUMN IF NOT EXISTS sets jsonb;

-- Migrate existing data: convert weight/reps into sets array
UPDATE public.workouts
SET sets = jsonb_build_array(
  jsonb_build_object('set', 1, 'weight', COALESCE(weight, 0), 'reps', COALESCE(reps, 0))
)
WHERE sets IS NULL AND (weight IS NOT NULL OR reps IS NOT NULL);