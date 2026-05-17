-- Update get_ranking RPC to include equipped weapon (and shield/amulet) image_path so the UI can render an equipment overlay without per-row lookups.
CREATE OR REPLACE FUNCTION public.get_ranking(p_type text, p_gender text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date;
  v_result jsonb;
BEGIN
  IF p_type NOT IN ('volume','sessions','combo') THEN RAISE EXCEPTION 'invalid type'; END IF;
  IF p_gender NOT IN ('male','female') THEN RAISE EXCEPTION 'invalid gender'; END IF;

  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo')::date)::date;

  -- Pre-aggregate equipped items per user (small set)
  CREATE TEMP TABLE _eq_lookup ON COMMIT DROP AS
  SELECT
    ue.user_id,
    MAX(CASE WHEN ei.item_type = 'weapon' THEN ei.image_path END) AS weapon_image,
    MAX(CASE WHEN ei.item_type = 'weapon' THEN ei.rarity END) AS weapon_rarity,
    MAX(CASE WHEN ei.item_type = 'shield' THEN ei.image_path END) AS shield_image,
    MAX(CASE WHEN ei.item_type = 'shield' THEN ei.rarity END) AS shield_rarity,
    MAX(CASE WHEN ei.item_type = 'amulet' THEN ei.image_path END) AS amulet_image,
    MAX(CASE WHEN ei.item_type = 'amulet' THEN ei.rarity END) AS amulet_rarity
  FROM public.user_equipment ue
  JOIN public.equipment_items ei ON ei.id = ue.item_id
  WHERE ue.equipped = true
  GROUP BY ue.user_id;

  IF p_type = 'volume' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.value DESC), '[]'::jsonb) INTO v_result
    FROM (
      SELECT
        ua.user_id, ua.level, ua.equipped_title, ua.featured_badges,
        e.weapon_image, e.weapon_rarity, e.shield_image, e.shield_rarity, e.amulet_image, e.amulet_rarity,
        SUM(
          CASE WHEN w.sets IS NOT NULL AND jsonb_typeof(w.sets) = 'array' AND jsonb_array_length(w.sets) > 0 THEN (
            SELECT COALESCE(SUM(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0)),0)
            FROM jsonb_array_elements(w.sets) s)
          ELSE COALESCE(w.weight,0) * COALESCE(w.reps,0) END
        )::int AS value
      FROM public.user_avatars ua
      JOIN public.workouts w ON w.user_id = ua.user_id
      LEFT JOIN _eq_lookup e ON e.user_id = ua.user_id
      WHERE ua.gender = p_gender AND w.workout_date >= v_month_start
      GROUP BY ua.user_id, ua.level, ua.equipped_title, ua.featured_badges,
               e.weapon_image, e.weapon_rarity, e.shield_image, e.shield_rarity, e.amulet_image, e.amulet_rarity
      HAVING SUM(
        CASE WHEN w.sets IS NOT NULL AND jsonb_typeof(w.sets) = 'array' AND jsonb_array_length(w.sets) > 0 THEN (
          SELECT COALESCE(SUM(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0)),0)
          FROM jsonb_array_elements(w.sets) s)
        ELSE COALESCE(w.weight,0) * COALESCE(w.reps,0) END
      ) > 0
    ) r;
  ELSIF p_type = 'sessions' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.value DESC), '[]'::jsonb) INTO v_result
    FROM (
      SELECT ua.user_id, ua.level, ua.equipped_title, ua.featured_badges,
             e.weapon_image, e.weapon_rarity, e.shield_image, e.shield_rarity, e.amulet_image, e.amulet_rarity,
             COUNT(DISTINCT w.workout_date)::int AS value
      FROM public.user_avatars ua
      JOIN public.workouts w ON w.user_id = ua.user_id
      LEFT JOIN _eq_lookup e ON e.user_id = ua.user_id
      WHERE ua.gender = p_gender AND w.workout_date >= v_month_start
      GROUP BY ua.user_id, ua.level, ua.equipped_title, ua.featured_badges,
               e.weapon_image, e.weapon_rarity, e.shield_image, e.shield_rarity, e.amulet_image, e.amulet_rarity
      HAVING COUNT(DISTINCT w.workout_date) > 0
    ) r;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.value DESC), '[]'::jsonb) INTO v_result
    FROM (
      SELECT ua.user_id, ua.level, ua.equipped_title, ua.featured_badges,
             e.weapon_image, e.weapon_rarity, e.shield_image, e.shield_rarity, e.amulet_image, e.amulet_rarity,
             COALESCE(ua.max_combo_reached, 0) AS value
      FROM public.user_avatars ua
      LEFT JOIN _eq_lookup e ON e.user_id = ua.user_id
      WHERE ua.gender = p_gender AND COALESCE(ua.max_combo_reached, 0) > 0
    ) r;
  END IF;

  DROP TABLE IF EXISTS _eq_lookup;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranking(text, text) TO authenticated;