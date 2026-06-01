
-- 1) rival_battles: trainers must share a tenant with one of the players.
DROP POLICY IF EXISTS "Players view own battles" ON public.rival_battles;
CREATE POLICY "Players view own battles"
ON public.rival_battles
FOR SELECT
TO authenticated
USING (
  auth.uid() = player1_id
  OR auth.uid() = player2_id
  OR (
    has_role(auth.uid(), 'trainer'::app_role)
    AND (
      public.shares_tenant_with_me(player1_id)
      OR public.shares_tenant_with_me(player2_id)
    )
  )
);

-- 2) tenant_members: tighten self-insert WITH CHECK to prevent privilege escalation.
DROP POLICY IF EXISTS "Users can insert own membership" ON public.tenant_members;
CREATE POLICY "Users can insert own membership"
ON public.tenant_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    -- Customer self-join (invite-code flow). Cannot self-elevate.
    role = 'customer'
    -- Owner self-insert only allowed for tenants the user actually owns
    -- (created via Onboarding, where tenants.owner_user_id is set to auth.uid()).
    OR (
      role = 'owner'
      AND EXISTS (
        SELECT 1 FROM public.tenants t
        WHERE t.id = tenant_id AND t.owner_user_id = auth.uid()
      )
    )
  )
);
