
-- Create gym_settings table
CREATE TABLE public.gym_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  logo_url text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.gym_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view gym settings"
ON public.gym_settings FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Trainers can update gym settings"
ON public.gym_settings FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers can insert gym settings"
ON public.gym_settings FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

-- Insert default row
INSERT INTO public.gym_settings (id) VALUES (gen_random_uuid());

-- Create storage bucket for gym assets
INSERT INTO storage.buckets (id, name, public) VALUES ('gym-assets', 'gym-assets', true);

-- Storage policies
CREATE POLICY "Anyone can view gym assets"
ON storage.objects FOR SELECT
USING (bucket_id = 'gym-assets');

CREATE POLICY "Trainers can upload gym assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'gym-assets' AND EXISTS (
  SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'trainer'
));

CREATE POLICY "Trainers can update gym assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'gym-assets' AND EXISTS (
  SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'trainer'
));

CREATE POLICY "Trainers can delete gym assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'gym-assets' AND EXISTS (
  SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'trainer'
));
