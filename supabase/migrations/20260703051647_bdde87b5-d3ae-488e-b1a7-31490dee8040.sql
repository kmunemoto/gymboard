ALTER TABLE public.tenant_plans
  ADD COLUMN IF NOT EXISTS cycle_months integer,
  ADD COLUMN IF NOT EXISTS grace_days integer;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON public.profiles(tenant_id);