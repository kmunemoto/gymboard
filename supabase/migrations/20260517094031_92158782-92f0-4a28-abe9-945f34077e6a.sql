
CREATE OR REPLACE FUNCTION public.lookup_tenant_by_invite_code(p_code text)
RETURNS TABLE (
  id uuid,
  gym_name text,
  address text,
  logo_url text,
  primary_color text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.address, t.logo_url, t.primary_color
  FROM public.tenants t
  WHERE t.invite_code = lower(replace(p_code, '-', ''))
    AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_tenant_by_invite_code(text) TO anon, authenticated;
