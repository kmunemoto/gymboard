
-- Backfill: create user_avatars for all existing users missing one
INSERT INTO public.user_avatars (user_id, level, total_exp, coins, combo_count, last_session_date, max_combo_reached, combo_5_count)
SELECT u.id, 1, 0, 0, 0, NULL, 0, 0
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_avatars a WHERE a.user_id = u.id);

-- Trigger function: auto-create avatar on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user_avatar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_avatars (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_avatar ON auth.users;
CREATE TRIGGER on_auth_user_created_avatar
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_avatar();
