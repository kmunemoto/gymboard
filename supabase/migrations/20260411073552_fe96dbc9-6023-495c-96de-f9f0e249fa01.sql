
CREATE TABLE public.trial_bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  guest_name TEXT NOT NULL,
  guest_contact TEXT NOT NULL,
  booking_date TIMESTAMP WITH TIME ZONE NOT NULL,
  booking_type TEXT NOT NULL DEFAULT '初回無料体験',
  status TEXT NOT NULL DEFAULT '予約済み',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.trial_bookings ENABLE ROW LEVEL SECURITY;

-- Allow anyone (including anon) to read trial bookings for slot checking
CREATE POLICY "Anyone can view trial bookings"
ON public.trial_bookings
FOR SELECT
TO anon, authenticated
USING (true);

-- Anon can insert (public form submission)
CREATE POLICY "Anyone can insert trial bookings"
ON public.trial_bookings
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Only trainers can update
CREATE POLICY "Trainers can update trial bookings"
ON public.trial_bookings
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));

-- Only trainers can delete
CREATE POLICY "Trainers can delete trial bookings"
ON public.trial_bookings
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'trainer'::app_role));
