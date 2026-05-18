CREATE OR REPLACE FUNCTION public.assign_trainer_role(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- 自分自身のみ許可（未ログインは不可）
  IF auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cannot assign role for another user';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'trainer')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_trainer_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_trainer_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_trainer_role(uuid) TO authenticated;