CREATE OR REPLACE FUNCTION public.grant_gacha_ticket_on_workout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    INSERT INTO public.user_gacha_tickets (user_id, session_date)
    VALUES (NEW.user_id, NEW.workout_date)
    ON CONFLICT (user_id, session_date) WHERE session_date IS NOT NULL DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'grant_gacha_ticket_on_workout failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;