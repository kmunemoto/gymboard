
-- 1) oauth_states table for CSRF protection
CREATE TABLE IF NOT EXISTS public.oauth_states (
  nonce uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oauth_states TO authenticated;
GRANT ALL ON public.oauth_states TO service_role;

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

-- Only service_role uses this table directly; no policies for normal users (deny by default).
CREATE POLICY "service role manages oauth_states"
  ON public.oauth_states FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS oauth_states_expires_idx ON public.oauth_states (expires_at);

-- 2) RESTRICTIVE tenant-isolation policies on game/health tables.
-- A row is accessible only when caller owns it OR shares a tenant with the row's user.
-- Service role bypasses RLS, so cron/edge functions are unaffected.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'weight_journey',
    'user_avatars',
    'avatar_achievements',
    'user_titles',
    'avatar_exp_logs',
    'daily_missions',
    'gacha_results',
    'user_milestone_claims',
    'user_event_completion',
    'user_event_progress',
    'user_quest_progress',
    'rival_battle_entries',
    'rival_battle_rewards',
    'raid_damage_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_user_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_user_isolation ON public.%I
         AS RESTRICTIVE
         FOR ALL
         TO authenticated
         USING (auth.uid() = user_id OR public.shares_tenant_with_me(user_id))
         WITH CHECK (auth.uid() = user_id OR public.shares_tenant_with_me(user_id))',
      t
    );
  END LOOP;
END $$;

-- 3) Tighten raid_damage_logs open SELECT policy.
DROP POLICY IF EXISTS "Authenticated view damage logs" ON public.raid_damage_logs;
CREATE POLICY "Users and same-tenant trainers view damage logs"
  ON public.raid_damage_logs FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR (has_role(auth.uid(), 'trainer'::app_role) AND public.shares_tenant_with_me(user_id))
  );
