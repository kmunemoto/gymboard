-- Allow trainers to delete any workouts
CREATE POLICY "Trainers can delete any workouts"
ON public.workouts
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));
