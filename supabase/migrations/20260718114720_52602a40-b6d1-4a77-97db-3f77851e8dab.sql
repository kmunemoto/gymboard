ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS show_retention_alerts BOOLEAN NOT NULL DEFAULT true;