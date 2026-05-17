-- Add explicit UPDATE policy for meal-photos storage to prevent unauthorized overwrites
CREATE POLICY "Owners and trainers can update meal photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'meal-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR has_role(auth.uid(), 'trainer'::app_role)
    )
  );