ALTER TABLE public.exercises DROP CONSTRAINT IF EXISTS exercises_name_key;
DROP INDEX IF EXISTS public.exercises_name_key;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_tenant_name_key UNIQUE (tenant_id, name);