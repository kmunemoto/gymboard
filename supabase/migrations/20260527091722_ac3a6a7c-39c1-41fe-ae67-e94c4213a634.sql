-- 1. Restrict sensitive tenant columns from regular members
REVOKE SELECT (invite_code, stripe_customer_id, stripe_subscription_id) ON public.tenants FROM authenticated;
REVOKE SELECT (invite_code, stripe_customer_id, stripe_subscription_id) ON public.tenants FROM anon;

-- 2. RPC for owners and trainers to fetch their gym's invite code
CREATE OR REPLACE FUNCTION public.get_my_tenant_invite_code()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.invite_code
  FROM public.tenants t
  WHERE t.id = public.get_my_tenant_id()
    AND (t.owner_user_id = auth.uid() OR public.has_role(auth.uid(), 'trainer'::app_role))
$$;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_invite_code() TO authenticated;

-- 3. Storage: scope trainer access to their own tenant for meal-photos and posture-photos
DROP POLICY IF EXISTS "Owners and trainers can view meal photos" ON storage.objects;
DROP POLICY IF EXISTS "Owners and trainers can update meal photos" ON storage.objects;
DROP POLICY IF EXISTS "Owners and trainers can delete meal photos" ON storage.objects;
DROP POLICY IF EXISTS "Trainers can view all posture photos" ON storage.objects;

CREATE POLICY "Owners and tenant trainers can view meal photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'meal-photos'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR (
      public.has_role(auth.uid(), 'trainer'::app_role)
      AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)
    )
  )
);

CREATE POLICY "Owners and tenant trainers can update meal photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'meal-photos'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR (
      public.has_role(auth.uid(), 'trainer'::app_role)
      AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)
    )
  )
);

CREATE POLICY "Owners and tenant trainers can delete meal photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'meal-photos'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR (
      public.has_role(auth.uid(), 'trainer'::app_role)
      AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)
    )
  )
);

CREATE POLICY "Tenant trainers can view posture photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'posture-photos'
  AND public.has_role(auth.uid(), 'trainer'::app_role)
  AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)
);