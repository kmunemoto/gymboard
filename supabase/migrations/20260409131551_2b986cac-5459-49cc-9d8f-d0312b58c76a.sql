
CREATE OR REPLACE FUNCTION public.delete_customer_cascade(_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Trainers can delete any customer; customers can only delete themselves
  IF NOT public.has_role(auth.uid(), 'trainer') AND auth.uid() != _customer_id THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  DELETE FROM public.workouts WHERE user_id = _customer_id;
  DELETE FROM public.bookings WHERE user_id = _customer_id;
  DELETE FROM public.meals WHERE user_id = _customer_id;
  DELETE FROM public.messages WHERE sender_id = _customer_id OR receiver_id = _customer_id;
  DELETE FROM public.notification_settings WHERE user_id = _customer_id;
  DELETE FROM public.profiles WHERE user_id = _customer_id;
  DELETE FROM public.user_roles WHERE user_id = _customer_id;
END;
$$;
