CREATE OR REPLACE FUNCTION public.grant_equipment(p_user_id uuid, p_item_key text, p_obtained_via text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
  v_inserted boolean := false;
  v_row_count int;
  v_owned_count int;
  v_total_items int;
  v_already_completed boolean;
BEGIN
  IF p_user_id IS NULL OR p_item_key IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'missing_args');
  END IF;

  SELECT id, item_key, item_name, item_type, rarity, atk_bonus, def_bonus, hp_bonus, image_path
    INTO v_item
    FROM public.equipment_items WHERE item_key = p_item_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'item_not_found');
  END IF;

  INSERT INTO public.user_equipment (user_id, item_id, equipped)
  VALUES (p_user_id, v_item.id, false)
  ON CONFLICT (user_id, item_id) DO NOTHING;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  v_inserted := v_row_count > 0;

  IF v_inserted THEN
    SELECT COUNT(*) INTO v_owned_count FROM public.user_equipment WHERE user_id = p_user_id;
    SELECT COUNT(*) INTO v_total_items FROM public.equipment_items;
    IF v_owned_count >= v_total_items THEN
      SELECT EXISTS(
        SELECT 1 FROM public.avatar_achievements
         WHERE user_id = p_user_id AND achievement_key = 'arsenal_master'
      ) INTO v_already_completed;
      IF NOT v_already_completed THEN
        INSERT INTO public.avatar_achievements (user_id, achievement_key)
          VALUES (p_user_id, 'arsenal_master') ON CONFLICT DO NOTHING;
        INSERT INTO public.user_titles (user_id, title_key)
          VALUES (p_user_id, 'arsenal_master') ON CONFLICT (user_id, title_key) DO NOTHING;
        INSERT INTO public.user_avatars (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
        UPDATE public.user_avatars SET coins = coins + 200, updated_at = now() WHERE user_id = p_user_id;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'granted', v_inserted,
    'item_id', v_item.id,
    'item_key', v_item.item_key,
    'item_name', v_item.item_name,
    'item_type', v_item.item_type,
    'rarity', v_item.rarity,
    'atk_bonus', v_item.atk_bonus,
    'def_bonus', v_item.def_bonus,
    'hp_bonus', v_item.hp_bonus,
    'image_path', v_item.image_path,
    'obtained_via', p_obtained_via,
    'collection_completed',
      (v_inserted AND (
        SELECT COUNT(*) FROM public.user_equipment WHERE user_id = p_user_id
      ) >= (SELECT COUNT(*) FROM public.equipment_items))
  );
END $function$;