-- Allow trainers to delete measurements
CREATE POLICY "Trainers can delete any measurements"
ON public.user_measurements
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'trainer'));