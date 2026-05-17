
-- INSERT policies for onboarding
CREATE POLICY "Authenticated users can create tenant"
  ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Tenant owner can insert plans"
  ON public.tenant_plans FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid())
  );

CREATE POLICY "Users can insert own membership"
  ON public.tenant_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Ensure avatars bucket exists & is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read for avatars bucket
DO $$ BEGIN
  CREATE POLICY "Avatars are publicly readable"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can upload tenant logos"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated can update own avatars"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars' AND owner = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
