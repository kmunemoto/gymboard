CREATE POLICY "Trainers can delete any diagnoses"
ON public.skeletal_diagnoses
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));