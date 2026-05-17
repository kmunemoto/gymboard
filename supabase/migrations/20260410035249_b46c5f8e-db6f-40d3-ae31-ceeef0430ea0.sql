
-- 1. Re-create triggers on auth.users for profile + role auto-creation
CREATE OR REPLACE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- 2. Self-healing trigger: when a booking is inserted, ensure profiles & user_roles exist
CREATE OR REPLACE FUNCTION public.ensure_customer_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ensure profile exists
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.user_id, NEW.user_id::text)
  ON CONFLICT (user_id) DO NOTHING;

  -- Ensure customer role exists
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_booking_ensure_customer
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_customer_on_booking();

-- 3. Enable realtime for bookings and profiles
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
