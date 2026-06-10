CREATE TABLE public.migration_user_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  salute_user_id uuid NOT NULL,
  gymboard_user_id uuid NOT NULL,
  email text NOT NULL,
  migrated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, salute_user_id)
);

GRANT SELECT ON public.migration_user_map TO authenticated;
GRANT ALL ON public.migration_user_map TO service_role;

ALTER TABLE public.migration_user_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant owner can view migration_user_map"
  ON public.migration_user_map
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));