
-- 1. Drop the privilege-escalation RPC. Trainer assignment moves to a server-side
--    edge function gated by a shared invite code (TRAINER_SIGNUP_CODE secret).
DROP FUNCTION IF EXISTS public.assign_trainer_role(uuid);

-- 2. Lock down Stripe identifier columns on tenants from regular users.
REVOKE SELECT (stripe_customer_id, stripe_subscription_id) ON public.tenants FROM authenticated;
REVOKE SELECT (stripe_customer_id, stripe_subscription_id) ON public.tenants FROM anon;
REVOKE UPDATE (stripe_customer_id, stripe_subscription_id) ON public.tenants FROM authenticated;
REVOKE UPDATE (stripe_customer_id, stripe_subscription_id) ON public.tenants FROM anon;
REVOKE INSERT (stripe_customer_id, stripe_subscription_id) ON public.tenants FROM authenticated;
REVOKE INSERT (stripe_customer_id, stripe_subscription_id) ON public.tenants FROM anon;

-- 3. Tenant isolation RESTRICTIVE policies on game/coin tables that currently
--    allow any trainer to read records belonging to customers of other gyms.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'coin_purchases',
    'user_gacha_tickets',
    'user_raid_rewards',
    'weight_journey_milestones',
    'quest_battle_logs',
    'dungeon_runs',
    'user_stamina',
    'user_equipment',
    'avatar_collection_rewards',
    'avatar_rank_up_rewards',
    'daily_login_bonuses',
    'user_quest_boss_progress',
    'user_quest_stage_completions',
    'user_frame_inventory',
    'user_materials',
    'user_battle_items',
    'user_companions',
    'user_customization_items',
    'announcement_reads'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_user_isolation ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_user_isolation ON public.%I AS RESTRICTIVE TO authenticated
         USING (user_id = auth.uid() OR public.shares_tenant_with_me(user_id))
         WITH CHECK (user_id = auth.uid() OR public.shares_tenant_with_me(user_id));',
      t
    );
  END LOOP;
END $$;

-- 4. Storage: progress-photos. Trainers must share tenant with the owner.
DROP POLICY IF EXISTS "Users can view own progress photos files" ON storage.objects;
CREATE POLICY "Users can view own progress photos files"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'progress-photos'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      public.has_role(auth.uid(), 'trainer')
      AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)
    )
  )
);

DROP POLICY IF EXISTS "Users can delete own progress photos files" ON storage.objects;
CREATE POLICY "Users can delete own progress photos files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'progress-photos'
  AND (
    (auth.uid())::text = (storage.foldername(name))[1]
    OR (
      public.has_role(auth.uid(), 'trainer')
      AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)
    )
  )
);

-- 5. Storage: gym-assets. Restrict trainer write/delete to their own
--    tenant_id folder. New uploads must use {tenant_id}/filename convention.
DROP POLICY IF EXISTS "Trainers can upload gym assets" ON storage.objects;
CREATE POLICY "Trainers can upload gym assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'gym-assets'
  AND public.has_role(auth.uid(), 'trainer')
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);

DROP POLICY IF EXISTS "Trainers can update gym assets" ON storage.objects;
CREATE POLICY "Trainers can update gym assets"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'gym-assets'
  AND public.has_role(auth.uid(), 'trainer')
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);

DROP POLICY IF EXISTS "Trainers can delete gym assets" ON storage.objects;
CREATE POLICY "Trainers can delete gym assets"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'gym-assets'
  AND public.has_role(auth.uid(), 'trainer')
  AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
);
