
-- Allow all authenticated users to find trainers
CREATE POLICY "Authenticated users can view trainer roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (role = 'trainer');
