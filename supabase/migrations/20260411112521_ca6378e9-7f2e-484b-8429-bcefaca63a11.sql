
CREATE OR REPLACE FUNCTION public.mark_trial_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET trial_completed = true
  WHERE user_id = NEW.user_id AND trial_completed = false;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_booking_mark_trial_completed
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.mark_trial_completed();
