-- Create google_calendar_tokens table
CREATE TABLE public.google_calendar_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trainers can view own tokens"
ON public.google_calendar_tokens FOR SELECT
TO authenticated
USING (auth.uid() = user_id AND public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can insert own tokens"
ON public.google_calendar_tokens FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can update own tokens"
ON public.google_calendar_tokens FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can delete own tokens"
ON public.google_calendar_tokens FOR DELETE
TO authenticated
USING (auth.uid() = user_id AND public.has_role(auth.uid(), 'trainer'));

CREATE TRIGGER update_google_calendar_tokens_updated_at
BEFORE UPDATE ON public.google_calendar_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add google_event_id to bookings table
ALTER TABLE public.bookings ADD COLUMN google_event_id TEXT;