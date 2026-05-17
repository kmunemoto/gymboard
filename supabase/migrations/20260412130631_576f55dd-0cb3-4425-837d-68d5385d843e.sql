
-- Add image_url column
ALTER TABLE public.skeletal_diagnoses
ADD COLUMN image_url text;

-- Create private storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('posture-photos', 'posture-photos', false);

-- Users can upload to their own folder
CREATE POLICY "Users can upload own posture photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'posture-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Users can view own photos
CREATE POLICY "Users can view own posture photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'posture-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Trainers can view all posture photos
CREATE POLICY "Trainers can view all posture photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'posture-photos'
  AND public.has_role(auth.uid(), 'trainer')
);
