
-- Drop the existing authenticated-only SELECT policy
DROP POLICY IF EXISTS "Anyone can view gym settings" ON public.gym_settings;

-- Create a public SELECT policy so unauthenticated users (login page) can also see the logo
CREATE POLICY "Anyone can view gym settings"
ON public.gym_settings
FOR SELECT
TO anon, authenticated
USING (true);
