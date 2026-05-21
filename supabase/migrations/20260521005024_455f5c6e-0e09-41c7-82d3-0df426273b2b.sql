
CREATE OR REPLACE FUNCTION public.seed_demo_data(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_trainer boolean;
  v_plan1 uuid;
  v_plan2 uuid;
  v_uid1 uuid := gen_random_uuid();
  v_uid2 uuid := gen_random_uuid();
  v_uid3 uuid := gen_random_uuid();
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
  v_tomorrow date := v_today + 1;
  v_customers_added int := 0;
  v_bookings_added int := 0;
  v_exercises_added int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE tenant_id = p_tenant_id AND user_id = v_caller
      AND role IN ('owner','trainer') AND status = 'active'
  ) INTO v_is_trainer;
  IF NOT v_is_trainer THEN
    RAISE EXCEPTION 'Not authorized for this tenant';
  END IF;

  SELECT id INTO v_plan1 FROM public.tenant_plans
    WHERE tenant_id = p_tenant_id ORDER BY sort_order, created_at LIMIT 1;
  SELECT id INTO v_plan2 FROM public.tenant_plans
    WHERE tenant_id = p_tenant_id ORDER BY sort_order, created_at OFFSET 1 LIMIT 1;
  IF v_plan2 IS NULL THEN v_plan2 := v_plan1; END IF;

  -- Create 3 fake auth.users
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_uid1, 'authenticated', 'authenticated', 'demo-'||v_uid1||'@example.com', '', now(), now(), now(), '{"provider":"demo","providers":["demo"]}'::jsonb, '{}'::jsonb, false, false, false),
    ('00000000-0000-0000-0000-000000000000', v_uid2, 'authenticated', 'authenticated', 'demo-'||v_uid2||'@example.com', '', now(), now(), now(), '{"provider":"demo","providers":["demo"]}'::jsonb, '{}'::jsonb, false, false, false),
    ('00000000-0000-0000-0000-000000000000', v_uid3, 'authenticated', 'authenticated', 'demo-'||v_uid3||'@example.com', '', now(), now(), now(), '{"provider":"demo","providers":["demo"]}'::jsonb, '{}'::jsonb, false, false, false);

  INSERT INTO public.profiles (user_id, display_name) VALUES
    (v_uid1, '田中 美咲'),
    (v_uid2, '鈴木 健太'),
    (v_uid3, '山本 さくら');

  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, display_name, plan_id, plan_start_date, cycle_start_date) VALUES
    (p_tenant_id, v_uid1, 'customer', 'active', '田中 美咲', v_plan1, v_today, v_today),
    (p_tenant_id, v_uid2, 'customer', 'active', '鈴木 健太', v_plan1, v_today, v_today),
    (p_tenant_id, v_uid3, 'customer', 'active', '山本 さくら', v_plan2, v_today, v_today);
  v_customers_added := 3;

  -- Bookings (JST times stored as timestamptz)
  INSERT INTO public.bookings (user_id, tenant_id, booking_date, booking_type, status) VALUES
    (v_uid1, p_tenant_id, ((v_today::text || ' 10:00:00')::timestamp AT TIME ZONE 'Asia/Tokyo'), '通常', '予約済み'),
    (v_uid2, p_tenant_id, ((v_today::text || ' 14:00:00')::timestamp AT TIME ZONE 'Asia/Tokyo'), '通常', '予約済み'),
    (v_uid3, p_tenant_id, ((v_tomorrow::text || ' 11:00:00')::timestamp AT TIME ZONE 'Asia/Tokyo'), '通常', '予約済み');
  v_bookings_added := 3;

  -- Exercises (name has UNIQUE constraint -> use ON CONFLICT)
  WITH ins AS (
    INSERT INTO public.exercises (tenant_id, name, category, muscle_group, sort_order) VALUES
      (p_tenant_id, 'ベンチプレス', 'フリーウェイト', '胸', 1),
      (p_tenant_id, 'スクワット', 'フリーウェイト', '脚', 2),
      (p_tenant_id, 'デッドリフト', 'フリーウェイト', '背中', 3),
      (p_tenant_id, 'ショルダープレス', 'フリーウェイト', '肩', 4),
      (p_tenant_id, 'バイセップカール', 'フリーウェイト', '腕', 5)
    ON CONFLICT (name) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_exercises_added FROM ins;

  RETURN jsonb_build_object(
    'customers', v_customers_added,
    'bookings', v_bookings_added,
    'exercises', v_exercises_added
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_demo_data(uuid) TO authenticated;
