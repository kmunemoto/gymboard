CREATE OR REPLACE FUNCTION public.notify_trainer_new_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
  service_key text;
  v_display_name text;
  v_signup_date text;
BEGIN
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_service_role_key';

  IF service_key IS NULL THEN
    RAISE LOG 'notify_trainer_new_signup: vault secret missing, skipping';
    RETURN NEW;
  END IF;

  v_display_name := COALESCE(NEW.raw_user_meta_data->>'display_name', '');
  v_signup_date := to_char(NEW.created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY"年"MM"月"DD"日" HH24:MI');

  PERFORM net.http_post(
    url := 'https://gvgrqaigffxtkvckjfur.supabase.co/functions/v1/send-transactional-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'templateName', 'new-account-notification',
      'idempotencyKey', 'new-account-' || NEW.id::text,
      'templateData', jsonb_build_object(
        'customerEmail', NEW.email,
        'displayName', v_display_name,
        'signupDate', v_signup_date
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_trainer_new_signup failed: %', SQLERRM;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS on_auth_user_created_notify_trainer ON auth.users;
CREATE TRIGGER on_auth_user_created_notify_trainer
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.notify_trainer_new_signup();