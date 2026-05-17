
CREATE TABLE public.counseling_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  last_name text NOT NULL,
  first_name text NOT NULL,
  last_name_kana text,
  first_name_kana text,
  age text,
  gender text,
  phone text,
  email text,
  purposes text[],
  experience_level text,
  target_frequency text,
  exercise_habit text,
  diet_pattern text,
  sleep_hours text,
  pain_areas text[],
  medical_history text,
  notes text,
  reviewed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.counseling_responses ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts from the counseling sheet app
CREATE POLICY "Anyone can insert counseling responses"
  ON public.counseling_responses
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only trainers can view
CREATE POLICY "Trainers can view counseling responses"
  ON public.counseling_responses
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

-- Only trainers can update (mark as reviewed)
CREATE POLICY "Trainers can update counseling responses"
  ON public.counseling_responses
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

-- Only trainers can delete
CREATE POLICY "Trainers can delete counseling responses"
  ON public.counseling_responses
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));
