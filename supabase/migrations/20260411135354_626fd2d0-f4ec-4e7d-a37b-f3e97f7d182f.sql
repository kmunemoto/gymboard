
-- Drop the overly broad RESTRICTIVE policy that blocks ALL including SELECT
DROP POLICY IF EXISTS "Restrictive: block all authenticated writes" ON public.user_roles;

-- Add RESTRICTIVE policies only for write operations (not SELECT)
CREATE POLICY "Restrictive: block authenticated inserts"
ON public.user_roles
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "Restrictive: block authenticated updates"
ON public.user_roles
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

CREATE POLICY "Restrictive: block authenticated deletes"
ON public.user_roles
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (false);
