
CREATE TABLE public.user_measurements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  measured_date date NOT NULL DEFAULT CURRENT_DATE,
  weight numeric,
  body_fat numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, measured_date)
);

ALTER TABLE public.user_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own measurements"
  ON public.user_measurements FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Trainers can view all measurements"
  ON public.user_measurements FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Users can insert own measurements"
  ON public.user_measurements FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Trainers can insert any measurements"
  ON public.user_measurements FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Users can update own measurements"
  ON public.user_measurements FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Trainers can update any measurements"
  ON public.user_measurements FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'));

CREATE TRIGGER update_user_measurements_updated_at
  BEFORE UPDATE ON public.user_measurements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
