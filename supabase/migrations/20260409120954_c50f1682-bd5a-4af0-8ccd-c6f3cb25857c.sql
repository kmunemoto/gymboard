
CREATE POLICY "Trainers can insert any bookings"
ON public.bookings FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));
