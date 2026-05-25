
-- 1. has_tenant_role now requires active membership
CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id uuid, _user_id uuid, _roles text[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = _tenant_id
      AND user_id = _user_id
      AND role = ANY(_roles)
      AND status = 'active'
  )
$function$;

-- 2. Helper: does a target user share an active tenant with me?
CREATE OR REPLACE FUNCTION public.shares_tenant_with_me(_target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.user_id = _target_user_id
      AND tm.status = 'active'
      AND tm.tenant_id = public.get_my_tenant_id()
  )
$function$;

-- 3. Profiles: restrict trainer cross-tenant SELECT/UPDATE via restrictive policies
DROP POLICY IF EXISTS "profiles_tenant_scope_select" ON public.profiles;
CREATE POLICY "profiles_tenant_scope_select"
ON public.profiles
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.shares_tenant_with_me(user_id)
);

DROP POLICY IF EXISTS "profiles_tenant_scope_update" ON public.profiles;
CREATE POLICY "profiles_tenant_scope_update"
ON public.profiles
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
  OR public.shares_tenant_with_me(user_id)
);

-- 4. skeletal_diagnoses: restrict trainer cross-tenant SELECT/DELETE
DROP POLICY IF EXISTS "skeletal_diagnoses_tenant_scope_select" ON public.skeletal_diagnoses;
CREATE POLICY "skeletal_diagnoses_tenant_scope_select"
ON public.skeletal_diagnoses
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.shares_tenant_with_me(user_id)
);

DROP POLICY IF EXISTS "skeletal_diagnoses_tenant_scope_delete" ON public.skeletal_diagnoses;
CREATE POLICY "skeletal_diagnoses_tenant_scope_delete"
ON public.skeletal_diagnoses
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
  OR public.shares_tenant_with_me(user_id)
);

-- 5. Enforce trial_bookings.tenant_id NOT NULL
ALTER TABLE public.trial_bookings ALTER COLUMN tenant_id SET NOT NULL;

-- 6. Storage: owner-scoped UPDATE policies for posture-photos and progress-photos
DROP POLICY IF EXISTS "Users can update own posture photos" ON storage.objects;
CREATE POLICY "Users can update own posture photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'posture-photos'
  AND (storage.foldername(name))[1] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = 'posture-photos'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

DROP POLICY IF EXISTS "Users can update own progress photos files" ON storage.objects;
CREATE POLICY "Users can update own progress photos files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'progress-photos'
  AND (storage.foldername(name))[1] = (auth.uid())::text
)
WITH CHECK (
  bucket_id = 'progress-photos'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);
