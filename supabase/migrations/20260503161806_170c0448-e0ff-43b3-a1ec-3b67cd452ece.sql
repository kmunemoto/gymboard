DROP TRIGGER IF EXISTS check_trial_rate_limit ON public.trial_bookings;
DROP FUNCTION IF EXISTS public.check_trial_booking_rate_limit();