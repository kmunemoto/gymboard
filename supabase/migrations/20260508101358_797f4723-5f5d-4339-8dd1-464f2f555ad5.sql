
-- Replace distribute_raid_rewards with gender-aware MVP logic
CREATE OR REPLACE FUNCTION public.distribute_raid_rewards(p_raid_boss_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_boss record;
  v_total int;
  v_total_male int;
  v_total_female int;
  v_male_max int;
  v_female_max int;
  v_contributor_cutoff int;
  v_participants int := 0;
  v_contributors int := 0;
  v_mvps int := 0;
  v_male_mvps int := 0;
  v_female_mvps int := 0;
  v_items_granted int := 0;
  ranked_user record;
  reward_item record;
  v_rank text;
  v_male_mvp_info jsonb := '[]'::jsonb;
  v_female_mvp_info jsonb := '[]'::jsonb;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(), 'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_boss FROM public.raid_bosses WHERE id = p_raid_boss_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ボスが見つかりません'; END IF;
  IF NOT v_boss.defeated THEN RAISE EXCEPTION 'ボスはまだ撃破されていません'; END IF;

  -- Aggregate damage per user, with gender + display_name
  CREATE TEMP TABLE _agg ON COMMIT DROP AS
  SELECT
    rdl.user_id,
    SUM(rdl.damage)::int AS total_damage,
    ua.gender AS gender,
    COALESCE(p.display_name, '') AS display_name
  FROM public.raid_damage_logs rdl
  LEFT JOIN public.user_avatars ua ON ua.user_id = rdl.user_id
  LEFT JOIN public.profiles p ON p.user_id = rdl.user_id
  WHERE rdl.raid_id = p_raid_boss_id
  GROUP BY rdl.user_id, ua.gender, p.display_name
  HAVING SUM(rdl.damage) >= 1;

  SELECT COUNT(*) INTO v_total FROM _agg;
  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'participants',0,'contributors',0,'mvps',0,
      'male_participants',0,'female_participants',0,
      'male_mvps','[]'::jsonb,'female_mvps','[]'::jsonb,
      'items_granted',0
    );
  END IF;

  SELECT COUNT(*) INTO v_total_male FROM _agg WHERE gender = 'male';
  SELECT COUNT(*) INTO v_total_female FROM _agg WHERE gender = 'female';

  SELECT MAX(total_damage) INTO v_male_max FROM _agg WHERE gender = 'male';
  SELECT MAX(total_damage) INTO v_female_max FROM _agg WHERE gender = 'female';

  -- contributor cutoff = top 50% of all participants, rounded up
  v_contributor_cutoff := CEIL(v_total::numeric / 2.0)::int;

  -- collect MVP info
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'display_name', display_name, 'damage', total_damage)), '[]'::jsonb)
    INTO v_male_mvp_info FROM _agg WHERE gender = 'male' AND total_damage = v_male_max AND v_male_max IS NOT NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'display_name', display_name, 'damage', total_damage)), '[]'::jsonb)
    INTO v_female_mvp_info FROM _agg WHERE gender = 'female' AND total_damage = v_female_max AND v_female_max IS NOT NULL;

  FOR ranked_user IN
    SELECT user_id, total_damage, gender,
           ROW_NUMBER() OVER (ORDER BY total_damage DESC) AS rnk
    FROM _agg
  LOOP
    v_participants := v_participants + 1;

    -- Determine rank
    IF ranked_user.gender = 'male' AND v_male_max IS NOT NULL AND ranked_user.total_damage = v_male_max THEN
      v_rank := 'mvp'; v_mvps := v_mvps + 1; v_male_mvps := v_male_mvps + 1;
      v_contributors := v_contributors + 1;
    ELSIF ranked_user.gender = 'female' AND v_female_max IS NOT NULL AND ranked_user.total_damage = v_female_max THEN
      v_rank := 'mvp'; v_mvps := v_mvps + 1; v_female_mvps := v_female_mvps + 1;
      v_contributors := v_contributors + 1;
    ELSIF ranked_user.rnk <= v_contributor_cutoff THEN
      v_rank := 'contributor'; v_contributors := v_contributors + 1;
    ELSE
      v_rank := 'participant';
    END IF;

    FOR reward_item IN
      SELECT * FROM public.raid_reward_items
      WHERE raid_boss_id = p_raid_boss_id
        AND (
          required_rank = 'participant'
          OR (required_rank = 'contributor' AND v_rank IN ('contributor','mvp'))
          OR (required_rank = 'mvp' AND v_rank = 'mvp')
        )
    LOOP
      INSERT INTO public.user_raid_rewards (user_id, item_key, raid_boss_id, earned_rank)
      VALUES (ranked_user.user_id, reward_item.item_key, p_raid_boss_id, v_rank)
      ON CONFLICT (user_id, item_key) DO NOTHING;

      IF FOUND THEN
        v_items_granted := v_items_granted + 1;
      END IF;

      IF reward_item.category = 'title' THEN
        INSERT INTO public.user_titles (user_id, title_key)
        VALUES (ranked_user.user_id, reward_item.item_key)
        ON CONFLICT (user_id, title_key) DO NOTHING;
      END IF;

      IF reward_item.category = 'badge' THEN
        INSERT INTO public.avatar_achievements (user_id, achievement_key)
        VALUES (ranked_user.user_id, reward_item.item_key)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'participants', v_participants,
    'male_participants', v_total_male,
    'female_participants', v_total_female,
    'contributors', v_contributors,
    'mvps', v_mvps,
    'male_mvps', v_male_mvp_info,
    'female_mvps', v_female_mvp_info,
    'items_granted', v_items_granted
  );
END;
$function$;
