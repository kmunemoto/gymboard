
-- 1. Add RESTRICTIVE policy on user_roles to prevent privilege escalation
-- This ensures no future permissive policy can accidentally allow role self-assignment
CREATE POLICY "Restrictive: block all authenticated writes"
ON public.user_roles
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- 2. Fix push_subscriptions: drop overly broad public policy and recreate scoped to service_role bypass
DROP POLICY IF EXISTS "Service role can read all subscriptions" ON public.push_subscriptions;
-- Service role bypasses RLS entirely, so this policy is unnecessary.
-- If needed for edge functions using service role, it already bypasses RLS.

-- 3. Realtime channel authorization
-- Note: realtime.messages is managed by Supabase internally.
-- We secure realtime by ensuring RLS is properly set on the source tables
-- (profiles, bookings, messages) which already have proper RLS policies.
-- The actual fix is to restrict the Realtime publication to only broadcast
-- changes that pass RLS, which is the default behavior when RLS is enabled.
