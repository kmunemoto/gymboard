CREATE TABLE public.exercise_id_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  salute_exercise_id uuid NOT NULL,
  gymboard_exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, salute_exercise_id)
);

GRANT SELECT ON public.exercise_id_map TO authenticated;
GRANT ALL ON public.exercise_id_map TO service_role;

ALTER TABLE public.exercise_id_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant owner can view exercise_id_map"
  ON public.exercise_id_map
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));