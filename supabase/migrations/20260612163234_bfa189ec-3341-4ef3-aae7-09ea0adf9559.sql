CREATE TABLE public.repair_skipped_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salute_user_id uuid,
  gymboard_user_id uuid NOT NULL,
  booking_date timestamptz NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gymboard_user_id, booking_date)
);
GRANT ALL ON public.repair_skipped_bookings TO service_role;
ALTER TABLE public.repair_skipped_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role only" ON public.repair_skipped_bookings FOR ALL TO service_role USING (true) WITH CHECK (true);