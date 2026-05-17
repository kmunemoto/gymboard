CREATE OR REPLACE FUNCTION public.initialize_starter_equipment_for_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing int;
  v_w uuid; v_s uuid; v_a uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('granted', 0); END IF;

  SELECT COUNT(*) INTO v_existing FROM public.user_equipment WHERE user_id = p_user_id;
  IF v_existing > 0 THEN RETURN jsonb_build_object('granted', 0, 'skipped', true); END IF;

  SELECT id INTO v_w FROM public.equipment_items WHERE item_key = 'wooden_sword';
  SELECT id INTO v_s FROM public.equipment_items WHERE item_key = 'wooden_shield';
  SELECT id INTO v_a FROM public.equipment_items WHERE item_key = 'bandana_red';

  IF v_w IS NOT NULL THEN
    INSERT INTO public.user_equipment (user_id, item_id, equipped) VALUES (p_user_id, v_w, true)
      ON CONFLICT (user_id, item_id) DO NOTHING;
  END IF;
  IF v_s IS NOT NULL THEN
    INSERT INTO public.user_equipment (user_id, item_id, equipped) VALUES (p_user_id, v_s, true)
      ON CONFLICT (user_id, item_id) DO NOTHING;
  END IF;
  IF v_a IS NOT NULL THEN
    INSERT INTO public.user_equipment (user_id, item_id, equipped) VALUES (p_user_id, v_a, true)
      ON CONFLICT (user_id, item_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('granted', 3);
END $function$;