
-- 1. Fix trial_bookings: restrict SELECT to trainers only
DROP POLICY IF EXISTS "Anyone can view trial bookings" ON public.trial_bookings;

CREATE POLICY "Trainers can view trial bookings"
ON public.trial_bookings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'trainer'::app_role));

-- Create a safe RPC for slot availability (no PII exposed)
CREATE OR REPLACE FUNCTION public.get_booked_slots(check_date date)
RETURNS TABLE(booking_date timestamptz, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tb.booking_date, tb.status
  FROM public.trial_bookings tb
  WHERE tb.booking_date::date = check_date
  UNION ALL
  SELECT b.booking_date, b.status
  FROM public.bookings b
  WHERE b.booking_date::date = check_date;
$$;

-- 2. Fix trial_bookings INSERT: restrict to only anon (keep open but add basic check)
DROP POLICY IF EXISTS "Anyone can insert trial bookings" ON public.trial_bookings;

CREATE POLICY "Guests can insert trial bookings"
ON public.trial_bookings
FOR INSERT
TO anon, authenticated
WITH CHECK (
  guest_name IS NOT NULL AND
  guest_contact IS NOT NULL AND
  booking_date IS NOT NULL AND
  status = '予約済み' AND
  booking_type = '初回無料体験'
);

-- 3. Fix user_roles: prevent privilege escalation
-- RLS is already enabled. The table currently has no INSERT/UPDATE/DELETE policies.
-- Since handle_new_user_role trigger uses SECURITY DEFINER, it bypasses RLS.
-- We add explicit restrictive policies for safety.

CREATE POLICY "Only service role can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (false);

CREATE POLICY "Only service role can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (false);

CREATE POLICY "Only service role can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (false);

-- 4. Fix workouts: allow users to update own workouts
CREATE POLICY "Users can update own workouts"
ON public.workouts
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
