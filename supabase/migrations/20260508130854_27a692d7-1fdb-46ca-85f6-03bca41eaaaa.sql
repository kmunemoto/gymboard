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
  IF p_type NOT IN ('volume','sessions','combo') THEN
    RAISE EXCEPTION 'invalid type';
  END IF;
  IF p_gender NOT IN ('male','female') THEN
    RAISE EXCEPTION 'invalid gender';
  END IF;

  v_month_start := date_trunc('month', (now() AT TIME ZONE 'Asia/Tokyo')::date)::date;

  IF p_type = 'volume' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.value DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        ua.user_id,
        ua.level,
        ua.equipped_title,
        ua.featured_badges,
        SUM(
          CASE
            WHEN w.sets IS NOT NULL AND jsonb_typeof(w.sets) = 'array' AND jsonb_array_length(w.sets) > 0 THEN (
              SELECT COALESCE(SUM(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0)),0)
              FROM jsonb_array_elements(w.sets) s
            )
            ELSE COALESCE(w.weight,0) * COALESCE(w.reps,0)
          END
        )::int AS value
      FROM public.user_avatars ua
      JOIN public.workouts w ON w.user_id = ua.user_id
      WHERE ua.gender = p_gender
        AND w.workout_date >= v_month_start
      GROUP BY ua.user_id, ua.level, ua.equipped_title, ua.featured_badges
      HAVING SUM(
        CASE
          WHEN w.sets IS NOT NULL AND jsonb_typeof(w.sets) = 'array' AND jsonb_array_length(w.sets) > 0 THEN (
            SELECT COALESCE(SUM(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0)),0)
            FROM jsonb_array_elements(w.sets) s
          )
          ELSE COALESCE(w.weight,0) * COALESCE(w.reps,0)
        END
      ) > 0
    ) r;
  ELSIF p_type = 'sessions' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.value DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        ua.user_id,
        ua.level,
        ua.equipped_title,
        ua.featured_badges,
        COUNT(DISTINCT w.workout_date)::int AS value
      FROM public.user_avatars ua
      JOIN public.workouts w ON w.user_id = ua.user_id
      WHERE ua.gender = p_gender
        AND w.workout_date >= v_month_start
      GROUP BY ua.user_id, ua.level, ua.equipped_title, ua.featured_badges
      HAVING COUNT(DISTINCT w.workout_date) > 0
    ) r;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.value DESC), '[]'::jsonb)
    INTO v_result
    FROM (
      SELECT
        ua.user_id,
        ua.level,
        ua.equipped_title,
        ua.featured_badges,
        COALESCE(ua.max_combo_reached, 0) AS value
      FROM public.user_avatars ua
      WHERE ua.gender = p_gender
        AND COALESCE(ua.max_combo_reached, 0) > 0
    ) r;
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranking(text, text) TO authenticated;