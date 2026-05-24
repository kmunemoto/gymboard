
-- 1. user_roles: restrict self-insert to 'customer' only
DROP POLICY IF EXISTS "Users can insert own role" ON public.user_roles;
CREATE POLICY "Users can insert own customer role"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND role = 'customer'::public.app_role);

-- 2. is_tenant_member: require active status
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = _tenant_id
      AND user_id = _user_id
      AND status = 'active'
  )
$function$;

-- 3. tenants: revoke client access to Stripe identifier columns
REVOKE SELECT (stripe_customer_id, stripe_subscription_id) ON public.tenants FROM authenticated, anon;

-- 4. counseling_responses: add tenant scoping
ALTER TABLE public.counseling_responses
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

DROP POLICY IF EXISTS "Trainers can view counseling responses" ON public.counseling_responses;
DROP POLICY IF EXISTS "Trainers can update counseling responses" ON public.counseling_responses;
DROP POLICY IF EXISTS "Trainers can delete counseling responses" ON public.counseling_responses;

CREATE POLICY "Trainers can view counseling responses"
ON public.counseling_responses
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'trainer'::public.app_role)
  AND (tenant_id IS NULL OR tenant_id = public.get_my_tenant_id())
);

CREATE POLICY "Trainers can update counseling responses"
ON public.counseling_responses
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'trainer'::public.app_role)
  AND (tenant_id IS NULL OR tenant_id = public.get_my_tenant_id())
);

CREATE POLICY "Trainers can delete counseling responses"
ON public.counseling_responses
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'trainer'::public.app_role)
  AND (tenant_id IS NULL OR tenant_id = public.get_my_tenant_id())
);

-- 5. avatars bucket: enforce folder ownership on upload
DROP POLICY IF EXISTS "Authenticated can upload tenant logos" ON storage.objects;
CREATE POLICY "Authenticated avatar uploads scoped to user folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (
      (storage.foldername(name))[1] = 'tenant-logos'
      AND public.has_role(auth.uid(), 'trainer'::public.app_role)
    )
  )
);

-- 6. posture-photos: allow owner deletes
CREATE POLICY "Users can delete own posture photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'posture-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
