
CREATE TABLE public.tenants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gym_name TEXT NOT NULL,
  gym_name_short TEXT,
  business_type TEXT NOT NULL DEFAULT 'personal_gym'
    CHECK (business_type IN ('personal_gym', 'pilates', 'yoga', 'seitai', 'other')),
  logo_url TEXT,
  primary_color TEXT DEFAULT '#3FB6AC',
  address TEXT,
  phone TEXT,
  email TEXT,
  website_url TEXT,
  operating_hours JSONB DEFAULT '{"start":"09:00","end":"21:00"}'::jsonb,
  slot_duration_minutes INTEGER DEFAULT 60,
  booking_cutoff_type TEXT DEFAULT 'prev_day'
    CHECK (booking_cutoff_type IN ('prev_day', 'hours_before')),
  booking_cutoff_hours INTEGER DEFAULT 24,
  owner_user_id UUID REFERENCES auth.users(id),
  invite_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(4), 'hex'),
  status TEXT DEFAULT 'trial'
    CHECK (status IN ('active', 'trial', 'suspended', 'cancelled')),
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '60 days'),
  gymboard_plan TEXT DEFAULT 'free'
    CHECK (gymboard_plan IN ('free', 'light', 'standard', 'premium')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  max_customers INTEGER DEFAULT 5,
  gamification_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.tenant_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  plan_type TEXT NOT NULL DEFAULT 'subscription'
    CHECK (plan_type IN ('subscription', 'ticket', 'period')),
  max_sessions INTEGER,
  price INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER,
  allow_overflow BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.tenant_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'customer'
    CHECK (role IN ('owner', 'trainer', 'customer')),
  plan_id UUID REFERENCES public.tenant_plans(id),
  plan_start_date DATE,
  ticket_remaining INTEGER,
  ticket_expires_at DATE,
  cycle_start_date DATE,
  display_name TEXT,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'cancelled')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id UUID, _user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant_id AND user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_role(_tenant_id UUID, _user_id UUID, _roles TEXT[])
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant_id AND user_id = _user_id AND role = ANY(_roles))
$$;

CREATE POLICY "Owners can view own tenant" ON public.tenants FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR public.is_tenant_member(id, auth.uid()));

CREATE POLICY "Owners can update own tenant" ON public.tenants FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY "Tenant members can view plans" ON public.tenant_plans FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "Tenant owner can manage plans" ON public.tenant_plans FOR ALL TO authenticated
  USING (tenant_id IN (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT id FROM public.tenants WHERE owner_user_id = auth.uid()));

CREATE POLICY "Members can view same tenant members" ON public.tenant_members FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

CREATE POLICY "Users can view own membership" ON public.tenant_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Trainers/owners can manage members" ON public.tenant_members FOR ALL TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DO $$
DECLARE
  v_tenant_id UUID;
  v_owner_id UUID;
  v_plan_4 UUID;
  v_plan_6 UUID;
  v_plan_8 UUID;
  v_plan_unlimited UUID;
BEGIN
  SELECT ur.user_id INTO v_owner_id
  FROM public.user_roles ur
  WHERE ur.role = 'trainer'
  LIMIT 1;

  INSERT INTO public.tenants (
    gym_name, gym_name_short, business_type,
    address, phone, email, website_url,
    primary_color, owner_user_id,
    status, gymboard_plan, max_customers,
    gamification_enabled, operating_hours, slot_duration_minutes, booking_cutoff_type
  ) VALUES (
    'パーソナルジムSalute御所南', 'Salute御所南', 'personal_gym',
    '京都市中京区毘沙門町533-1 プラザ御所南2階',
    '090-8386-0894', 'k.munemoto@kyoto-salute.com', 'https://kyoto-salute.com',
    '#3FB6AC', v_owner_id,
    'active', 'premium', 999,
    true, '{"start":"09:00","end":"21:00"}'::jsonb, 60, 'prev_day'
  ) RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_plans (tenant_id, plan_name, plan_type, max_sessions, price, sort_order)
  VALUES (v_tenant_id, '月4回', 'subscription', 4, 32000, 1) RETURNING id INTO v_plan_4;
  INSERT INTO public.tenant_plans (tenant_id, plan_name, plan_type, max_sessions, price, sort_order)
  VALUES (v_tenant_id, '月6回', 'subscription', 6, 42000, 2) RETURNING id INTO v_plan_6;
  INSERT INTO public.tenant_plans (tenant_id, plan_name, plan_type, max_sessions, price, sort_order)
  VALUES (v_tenant_id, '月8回', 'subscription', 8, 52000, 3) RETURNING id INTO v_plan_8;
  INSERT INTO public.tenant_plans (tenant_id, plan_name, plan_type, max_sessions, price, sort_order)
  VALUES (v_tenant_id, '通い放題', 'subscription', null, 65000, 4) RETURNING id INTO v_plan_unlimited;

  INSERT INTO public.tenant_members (tenant_id, user_id, role, display_name, cycle_start_date, plan_id)
  SELECT
    v_tenant_id,
    p.user_id,
    CASE WHEN EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.user_id AND ur.role = 'trainer')
         THEN 'trainer' ELSE 'customer' END,
    p.display_name,
    p.cycle_start_date,
    CASE p.plan
      WHEN '月4回' THEN v_plan_4
      WHEN '月6回' THEN v_plan_6
      WHEN '月8回' THEN v_plan_8
      WHEN '通い放題' THEN v_plan_unlimited
      ELSE null
    END
  FROM public.profiles p
  WHERE p.user_id IS NOT NULL
  ON CONFLICT (tenant_id, user_id) DO NOTHING;

  IF v_owner_id IS NOT NULL THEN
    UPDATE public.tenant_members SET role = 'owner'
    WHERE tenant_id = v_tenant_id AND user_id = v_owner_id;
  END IF;

  RAISE NOTICE 'Salute tenant created: %', v_tenant_id;
END $$;
