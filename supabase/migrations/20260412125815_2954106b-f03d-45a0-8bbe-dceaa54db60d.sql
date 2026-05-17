
CREATE TABLE public.skeletal_diagnoses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  skeletal_type text NOT NULL,
  confidence integer NOT NULL,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.skeletal_diagnoses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own diagnoses"
  ON public.skeletal_diagnoses FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own diagnoses"
  ON public.skeletal_diagnoses FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Trainers can view all diagnoses"
  ON public.skeletal_diagnoses FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));

CREATE INDEX idx_skeletal_diagnoses_user_id ON public.skeletal_diagnoses (user_id);
CREATE INDEX idx_skeletal_diagnoses_created_at ON public.skeletal_diagnoses (created_at DESC);
