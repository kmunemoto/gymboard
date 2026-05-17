-- progress_photos table
CREATE TABLE public.progress_photos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  photo_url TEXT NOT NULL,
  photo_type TEXT NOT NULL CHECK (photo_type IN ('front', 'side', 'back')),
  taken_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_progress_photos_user_date ON public.progress_photos(user_id, taken_date DESC);

ALTER TABLE public.progress_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own progress photos"
ON public.progress_photos FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Users can insert own progress photos"
ON public.progress_photos FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own progress photos"
ON public.progress_photos FOR DELETE
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'trainer'));

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('progress-photos', 'progress-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: files stored under <user_id>/<filename>
CREATE POLICY "Users can view own progress photos files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'progress-photos'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'trainer')
  )
);

CREATE POLICY "Users can upload own progress photos files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'progress-photos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete own progress photos files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'progress-photos'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.has_role(auth.uid(), 'trainer')
  )
);