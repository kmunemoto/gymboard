DROP POLICY IF EXISTS "Restrictive: block authenticated inserts" ON public.user_roles;
DROP POLICY IF EXISTS "Only service role can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can insert own role" ON public.user_roles;

CREATE POLICY "Users can insert own role"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());