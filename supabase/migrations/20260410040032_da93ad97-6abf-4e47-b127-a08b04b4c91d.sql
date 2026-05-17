CREATE POLICY "Trainers can delete any bookings"
ON public.bookings
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'trainer'::app_role));