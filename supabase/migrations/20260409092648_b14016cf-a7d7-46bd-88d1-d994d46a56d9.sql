-- Allow all authenticated users to view all bookings (needed for slot conflict checking)
CREATE POLICY "Authenticated users can view all bookings for availability"
ON public.bookings
FOR SELECT
TO authenticated
USING (true);
