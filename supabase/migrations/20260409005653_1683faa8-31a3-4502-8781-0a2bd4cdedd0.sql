
-- Create meals table
CREATE TABLE public.meals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url TEXT NOT NULL,
  meal_type TEXT NOT NULL DEFAULT '食事',
  calories INTEGER,
  protein NUMERIC(6,1),
  fat NUMERIC(6,1),
  carbs NUMERIC(6,1),
  fiber NUMERIC(6,1),
  feedback TEXT,
  analyzed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;

-- Demo policies (no auth required for now)
CREATE POLICY "Anyone can view meals" ON public.meals FOR SELECT USING (true);
CREATE POLICY "Anyone can insert meals" ON public.meals FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update meals" ON public.meals FOR UPDATE USING (true);

-- Storage bucket for meal photos
INSERT INTO storage.buckets (id, name, public) VALUES ('meal-photos', 'meal-photos', true);

CREATE POLICY "Anyone can view meal photos" ON storage.objects FOR SELECT USING (bucket_id = 'meal-photos');
CREATE POLICY "Anyone can upload meal photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'meal-photos');
