
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_owner boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = v_uid AND role = 'owner' AND status = 'active'
  ) INTO v_is_owner;

  IF v_is_owner THEN
    RAISE EXCEPTION 'Owner cannot delete account';
  END IF;

  DELETE FROM public.tenant_members WHERE user_id = v_uid;
  DELETE FROM public.user_roles WHERE user_id = v_uid;
  DELETE FROM public.profiles WHERE user_id = v_uid;
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
