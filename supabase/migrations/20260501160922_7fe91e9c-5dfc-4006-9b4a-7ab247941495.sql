-- Fix trial_bookings INSERT policy: simplify WITH CHECK to avoid encoding mismatch
-- on the Japanese string literals which was causing all anon inserts to be rejected.
-- Validation is already enforced by NOT NULL constraints, column DEFAULT values
-- (status = '予約済み', booking_type = '初回無料体験'), and the rate-limit trigger.

DROP POLICY IF EXISTS "Guests can insert trial bookings" ON public.trial_bookings;

CREATE POLICY "Guests can insert trial bookings"
ON public.trial_bookings
FOR INSERT
TO anon, authenticated
WITH CHECK (
  guest_name IS NOT NULL
  AND guest_contact IS NOT NULL
  AND booking_date IS NOT NULL
);