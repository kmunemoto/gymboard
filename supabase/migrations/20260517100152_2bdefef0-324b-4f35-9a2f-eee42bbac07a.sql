
-- 1. Helper: current user's tenant
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT tenant_id FROM public.tenant_members
  WHERE user_id = auth.uid() AND status = 'active'
  LIMIT 1;
$$;

-- 2. Add tenant_id columns
ALTER TABLE public.bookings              ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.trial_bookings        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.workouts              ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.exercises             ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.user_measurements     ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.meals                 ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.messages              ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.progress_photos       ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.blocked_slots         ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.monthly_reports       ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.announcements         ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);
ALTER TABLE public.notification_settings ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

-- 3. Backfill with oldest tenant
DO $$
DECLARE v_tid UUID;
BEGIN
  SELECT id INTO v_tid FROM public.tenants ORDER BY created_at ASC LIMIT 1;
  IF v_tid IS NOT NULL THEN
    UPDATE public.bookings              SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.trial_bookings        SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.workouts              SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.exercises             SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.user_measurements     SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.meals                 SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.messages              SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.progress_photos       SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.blocked_slots         SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.monthly_reports       SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.announcements         SET tenant_id = v_tid WHERE tenant_id IS NULL;
    UPDATE public.notification_settings SET tenant_id = v_tid WHERE tenant_id IS NULL;
  END IF;
END $$;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_bookings_tenant              ON public.bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trial_bookings_tenant        ON public.trial_bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_workouts_tenant              ON public.workouts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exercises_tenant             ON public.exercises(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_measurements_tenant     ON public.user_measurements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meals_tenant                 ON public.meals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant              ON public.messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_progress_photos_tenant       ON public.progress_photos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_tenant         ON public.blocked_slots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_monthly_reports_tenant       ON public.monthly_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_announcements_tenant         ON public.announcements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_settings_tenant ON public.notification_settings(tenant_id);

-- 5. RESTRICTIVE tenant-isolation policies (combine with existing permissive policies via AND)
-- Standard tables: tenant_id must match the caller's tenant
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY['bookings','workouts','exercises','user_measurements','meals',
                         'messages','progress_photos','blocked_slots','monthly_reports',
                         'announcements','notification_settings'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I AS RESTRICTIVE
      FOR ALL TO authenticated
      USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
      WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
    $f$, t);
  END LOOP;
END $$;

-- trial_bookings: SELECT/UPDATE/DELETE restricted to same tenant; INSERT (anon + auth) just requires tenant_id
DROP POLICY IF EXISTS tenant_isolation_select ON public.trial_bookings;
DROP POLICY IF EXISTS tenant_isolation_update ON public.trial_bookings;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.trial_bookings;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.trial_bookings;

CREATE POLICY tenant_isolation_select ON public.trial_bookings AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

CREATE POLICY tenant_isolation_update ON public.trial_bookings AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

CREATE POLICY tenant_isolation_delete ON public.trial_bookings AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

CREATE POLICY tenant_isolation_insert ON public.trial_bookings AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL);
