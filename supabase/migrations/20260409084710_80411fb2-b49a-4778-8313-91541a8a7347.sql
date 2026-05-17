CREATE POLICY "Trainers can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));