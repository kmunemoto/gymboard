-- Validation trigger: only one trainer allowed
CREATE OR REPLACE FUNCTION public.enforce_single_trainer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'trainer' THEN
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'trainer' AND user_id != NEW.user_id) THEN
      RAISE EXCEPTION 'トレーナーアカウントは1つのみ作成できます';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_single_trainer
BEFORE INSERT ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_trainer();
