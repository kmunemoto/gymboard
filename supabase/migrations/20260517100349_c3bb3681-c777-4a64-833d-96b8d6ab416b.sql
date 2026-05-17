
CREATE OR REPLACE FUNCTION public.get_default_tenant_public()
RETURNS TABLE (
  id uuid,
  gym_name text,
  gym_name_short text,
  address text,
  logo_url text,
  primary_color text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color
  FROM public.tenants t
  WHERE t.status IN ('active', 'trial')
  ORDER BY t.created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_default_tenant_public() TO anon, authenticated;
