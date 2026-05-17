ALTER TABLE public.profiles ALTER COLUMN plan SET DEFAULT NULL;
ALTER TABLE public.profiles ALTER COLUMN plan DROP NOT NULL;

-- Update existing customers who haven't completed trial to have NULL plan
UPDATE public.profiles SET plan = NULL WHERE trial_completed = false;