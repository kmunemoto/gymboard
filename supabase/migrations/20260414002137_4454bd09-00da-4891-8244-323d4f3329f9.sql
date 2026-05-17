CREATE TABLE public.monthly_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  month DATE NOT NULL,
  trainer_comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

ALTER TABLE public.monthly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own monthly reports"
ON public.monthly_reports FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Trainers can view all monthly reports"
ON public.monthly_reports FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can insert monthly reports"
ON public.monthly_reports FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can update monthly reports"
ON public.monthly_reports FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can delete monthly reports"
ON public.monthly_reports FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'trainer'));

CREATE TRIGGER update_monthly_reports_updated_at
BEFORE UPDATE ON public.monthly_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();