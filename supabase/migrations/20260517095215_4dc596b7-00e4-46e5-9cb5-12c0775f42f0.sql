CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
RETURNS TABLE (
  id uuid,
  gym_name text,
  gym_name_short text,
  address text,
  logo_url text,
  primary_color text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color
  FROM public.tenants t
  WHERE t.id = p_id
    AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated;