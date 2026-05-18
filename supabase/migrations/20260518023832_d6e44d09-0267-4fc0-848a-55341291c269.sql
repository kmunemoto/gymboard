DROP TRIGGER IF EXISTS check_single_trainer ON public.user_roles;
DROP FUNCTION IF EXISTS public.enforce_single_trainer();