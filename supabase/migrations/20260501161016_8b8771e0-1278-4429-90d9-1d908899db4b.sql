-- Grant base table privileges to anon and authenticated roles for trial_bookings.
-- Without these GRANTs, PostgREST rejects the INSERT before RLS is even evaluated,
-- which manifests as HTTP 401 + "row-level security policy" error.
GRANT INSERT ON public.trial_bookings TO anon, authenticated;
GRANT SELECT ON public.trial_bookings TO authenticated;
GRANT UPDATE, DELETE ON public.trial_bookings TO authenticated;