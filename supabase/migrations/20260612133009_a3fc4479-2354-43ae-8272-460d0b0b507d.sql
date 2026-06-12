CREATE TABLE IF NOT EXISTS public.notification_dedupe (
  idempotency_key text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.notification_dedupe TO service_role;
REVOKE ALL ON public.notification_dedupe FROM anon, authenticated;

ALTER TABLE public.notification_dedupe ENABLE ROW LEVEL SECURITY;
-- No policies → blocks anon/authenticated entirely. service_role bypasses RLS.