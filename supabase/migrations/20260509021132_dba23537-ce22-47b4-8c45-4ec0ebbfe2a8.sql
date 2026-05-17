
-- ============================================================
-- 1. grant_equipment helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.grant_equipment(
  p_user_id uuid,
  p_item_key text,
  p_obtained_via text DEFAULT 'system'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_inserted boolean := false;
  v_owned_count int;
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
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_inserted := v_inserted > 0;

  -- Collection completion check (12/12) – grants once
  IF v_inserted THEN
    SELECT COUNT(*) INTO v_owned_count
      FROM public.user_equipment WHERE user_id = p_user_id;
    IF v_owned_count >= 12 THEN
      SELECT EXISTS(
        SELECT 1 FROM public.avatar_achievements
         WHERE user_id = p_user_id AND achievement_key = 'arsenal_master'
      ) INTO v_already_completed;

      IF NOT v_already_completed THEN
        INSERT INTO public.avatar_achievements (user_id, achievement_key)
          VALUES (p_user_id, 'arsenal_master')
          ON CONFLICT DO NOTHING;
        INSERT INTO public.user_titles (user_id, title_key)
          VALUES (p_user_id, 'arsenal_master')
          ON CONFLICT (user_id, title_key) DO NOTHING;
        INSERT INTO public.user_avatars (user_id) VALUES (p_user_id) ON CONFLICT (user_id) DO NOTHING;
        UPDATE public.user_avatars
          SET coins = coins + 200, updated_at = now()
          WHERE user_id = p_user_id;
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
      ) >= 12)
  );
END $$;

-- ============================================================
-- 2. Starter equipment
-- ============================================================
CREATE OR REPLACE FUNCTION public.initialize_starter_equipment_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing int;
  v_w uuid; v_s uuid; v_a uuid;
BEGIN
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('granted', 0); END IF;

  SELECT COUNT(*) INTO v_existing FROM public.user_equipment WHERE user_id = p_user_id;
  IF v_existing > 0 THEN RETURN jsonb_build_object('granted', 0, 'skipped', true); END IF;

  SELECT id INTO v_w FROM public.equipment_items WHERE item_key = 'wooden_sword';
  SELECT id INTO v_s FROM public.equipment_items WHERE item_key = 'leather_shield';
  SELECT id INTO v_a FROM public.equipment_items WHERE item_key = 'stone_amulet';

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
END $$;

CREATE OR REPLACE FUNCTION public.initialize_starter_equipment()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_count int := 0;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(), 'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  FOR v_user IN
    SELECT DISTINCT p.user_id FROM public.profiles p
    LEFT JOIN public.user_equipment ue ON ue.user_id = p.user_id
    WHERE ue.user_id IS NULL
  LOOP
    PERFORM public.initialize_starter_equipment_for_user(v_user.user_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('users_initialized', v_count);
END $$;

-- ============================================================
-- 3. complete_quest_stage: grant stage rewards
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_quest_stage(p_user_id uuid, p_stage_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_stage record;
  v_values jsonb;
  v_unmet int;
  v_total_exp integer;
  v_old_level int;
  v_new_level int;
  v_required int;
  v_cumulative int := 0;
  v_lvl int := 1;
  v_added_coins int := 0;
  v_progress record;
  v_equipment jsonb := NULL;
  v_eq_key text := NULL;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
  IF v_user <> auth.uid() AND NOT has_role(auth.uid(),'trainer'::app_role) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_stage FROM public.quest_stages WHERE id = p_stage_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ステージが見つかりません'; END IF;

  v_values := public._quest_condition_values(v_user);
  SELECT COUNT(*) INTO v_unmet FROM public.quest_stage_conditions c
  WHERE c.stage_id = p_stage_id
    AND COALESCE((v_values->>c.condition_type)::numeric, 0) < c.target_value;
  IF v_unmet > 0 THEN
    RAISE EXCEPTION 'すべての条件を満たしていません';
  END IF;

  INSERT INTO public.user_quest_stage_completions (user_id, stage_id)
  VALUES (v_user, p_stage_id) ON CONFLICT (user_id, stage_id) DO NOTHING;

  INSERT INTO public.user_avatars (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
  VALUES (v_user, v_stage.reward_exp, 'quest_stage|' || p_stage_id::text, CURRENT_DATE)
  ON CONFLICT (user_id, reason, reference_date) DO NOTHING;

  SELECT level INTO v_old_level FROM public.user_avatars WHERE user_id = v_user;
  SELECT COALESCE(SUM(exp_amount),0) INTO v_total_exp FROM public.avatar_exp_logs WHERE user_id = v_user;
  WHILE v_lvl < 999 LOOP
    v_required := 250 + v_lvl * 50;
    EXIT WHEN v_total_exp < v_cumulative + v_required;
    v_cumulative := v_cumulative + v_required;
    v_lvl := v_lvl + 1;
  END LOOP;
  v_new_level := v_lvl;
  v_added_coins := GREATEST(0, v_new_level - COALESCE(v_old_level,1)) * 10;

  UPDATE public.user_avatars
  SET coins = coins + v_stage.reward_coins + v_added_coins,
      total_exp = v_total_exp,
      level = v_new_level,
      updated_at = now()
  WHERE user_id = v_user;

  IF v_stage.reward_title IS NOT NULL THEN
    INSERT INTO public.user_titles (user_id, title_key) VALUES (v_user, v_stage.reward_title)
    ON CONFLICT (user_id, title_key) DO NOTHING;
  END IF;

  IF v_stage.reward_badge_key IS NOT NULL THEN
    INSERT INTO public.avatar_achievements (user_id, achievement_key)
    VALUES (v_user, v_stage.reward_badge_key) ON CONFLICT DO NOTHING;
  END IF;

  IF v_stage.reward_frame THEN
    UPDATE public.user_avatars
    SET equipped_frame = COALESCE(equipped_frame, 'quest_kingdom_hero'), updated_at = now()
    WHERE user_id = v_user;
  END IF;

  -- Equipment grants for stages 3/4/7/8
  v_eq_key := CASE p_stage_id
    WHEN 3 THEN 'ice_shield'
    WHEN 4 THEN 'forest_charm'
    WHEN 7 THEN 'storm_barrier'
    WHEN 8 THEN 'crown_of_light'
    ELSE NULL
  END;
  IF v_eq_key IS NOT NULL THEN
    v_equipment := public.grant_equipment(v_user, v_eq_key, 'quest');
  END IF;

  SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user FOR UPDATE;
  IF v_progress.current_stage = p_stage_id THEN
    UPDATE public.user_quest_progress
    SET current_stage = LEAST(p_stage_id + 1, 8), updated_at = now()
    WHERE user_id = v_user;
  END IF;

  RETURN jsonb_build_object(
    'stage_id', p_stage_id,
    'reward_coins', v_stage.reward_coins,
    'reward_exp', v_stage.reward_exp,
    'reward_title', v_stage.reward_title,
    'reward_badge_key', v_stage.reward_badge_key,
    'reward_frame', v_stage.reward_frame,
    'reward_equipment', v_equipment,
    'next_stage', LEAST(p_stage_id + 1, 8),
    'leveled_up', v_new_level > COALESCE(v_old_level,1),
    'all_complete', p_stage_id = 8
  );
END;
$function$;

-- ============================================================
-- 4. distribute_raid_rewards: append weapon grants
-- ============================================================
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
  v_equipment_key text := NULL;
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

  -- Determine equipment by boss name
  IF v_boss.boss_name ILIKE '%ゴブリン%' OR v_boss.boss_name ILIKE '%goblin%' THEN
    v_equipment_key := 'goblin_blade';
  ELSIF v_boss.boss_name ILIKE '%オーク%' OR v_boss.boss_name ILIKE '%orc%' THEN
    v_equipment_key := 'orc_axe';
  ELSIF v_boss.boss_name ILIKE '%ドラゴン%' OR v_boss.boss_name ILIKE '%dragon%' THEN
    v_equipment_key := 'dragon_fang';
  END IF;

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
  v_contributor_cutoff := CEIL(v_total::numeric / 2.0)::int;

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
    IF ranked_user.gender = 'male' AND v_male_max IS NOT NULL AND ranked_user.total_damage = v_male_max THEN
      v_rank := 'mvp'; v_mvps := v_mvps + 1; v_male_mvps := v_male_mvps + 1; v_contributors := v_contributors + 1;
    ELSIF ranked_user.gender = 'female' AND v_female_max IS NOT NULL AND ranked_user.total_damage = v_female_max THEN
      v_rank := 'mvp'; v_mvps := v_mvps + 1; v_female_mvps := v_female_mvps + 1; v_contributors := v_contributors + 1;
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
      IF FOUND THEN v_items_granted := v_items_granted + 1; END IF;

      IF reward_item.category = 'title' THEN
        INSERT INTO public.user_titles (user_id, title_key) VALUES (ranked_user.user_id, reward_item.item_key)
        ON CONFLICT (user_id, title_key) DO NOTHING;
      END IF;
      IF reward_item.category = 'badge' THEN
        INSERT INTO public.avatar_achievements (user_id, achievement_key) VALUES (ranked_user.user_id, reward_item.item_key)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    -- Equipment grant for this raid boss
    IF v_equipment_key IS NOT NULL THEN
      PERFORM public.grant_equipment(ranked_user.user_id, v_equipment_key, 'raid');
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'participants', v_participants,
    'male_participants', v_total_male,
    'female_participants', v_total_female,
    'contributors', v_contributors,
    'mvps', v_mvps,
    'male_mvps', v_male_mvp_info,
    'female_mvps', v_female_mvp_info,
    'items_granted', v_items_granted,
    'equipment_key', v_equipment_key
  );
END;
$function$;

-- ============================================================
-- 5. spin_gacha: append epic equipment drop branch
-- ============================================================
CREATE OR REPLACE FUNCTION public.spin_gacha(_user_id uuid, _result_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket record;
  v_roll integer;
  v_rarity text;
  v_pool jsonb;
  v_idx integer;
  v_reward jsonb;
  v_total_exp integer;
  v_old_level integer;
  v_new_level integer;
  v_required integer;
  v_cumulative integer := 0;
  v_lvl integer := 1;
  v_added_coins integer := 0;
  v_remaining integer;
  v_user_level integer;
  v_pc integer; v_pr integer; v_pe integer;
  v_epic_count integer;
  v_legendary_bonus integer := 0;
  v_award_frame boolean := false;
  v_frame record;
  v_already_has_frame boolean := false;
  v_frame_dup_coins integer := 30;
  v_eq_pool text[];
  v_eq_key text;
  v_eq record;
  v_eq_owned boolean;
  v_eq_dup_coins integer := 50;
BEGIN
  IF auth.uid() IS DISTINCT FROM _user_id AND NOT has_role(auth.uid(), 'trainer'::app_role) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_ticket FROM public.user_gacha_tickets
  WHERE user_id = _user_id AND used = false
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('no_ticket', true, 'remaining', 0); END IF;

  SELECT COALESCE(level, 1) INTO v_user_level FROM public.user_avatars WHERE user_id = _user_id;
  v_user_level := COALESCE(v_user_level, 1);

  IF v_user_level <= 5 THEN v_pc:=60; v_pr:=85; v_pe:=97;
  ELSIF v_user_level <= 15 THEN v_pc:=57; v_pr:=82; v_pe:=96;
  ELSIF v_user_level <= 30 THEN v_pc:=53; v_pr:=78; v_pe:=95;
  ELSIF v_user_level <= 50 THEN v_pc:=49; v_pr:=74; v_pe:=94;
  ELSE v_pc:=42; v_pr:=67; v_pe:=92; END IF;

  SELECT COUNT(*) INTO v_epic_count FROM public.avatar_achievements
   WHERE user_id = _user_id AND achievement_key IN (
      'habit_formed','perfect_week','hundred_sessions','half_year','ten_ton_club',
      'gacha_legend','record_breaker','two_hundred_sessions','one_year','combo_king',
      'raid_mvp','month_200k','level_50');

  IF v_epic_count >= 10 THEN v_legendary_bonus := 2;
  ELSIF v_epic_count >= 5 THEN v_legendary_bonus := 1; END IF;

  v_pc := GREATEST(0, v_pc - v_legendary_bonus);
  v_pr := GREATEST(v_pc, v_pr - v_legendary_bonus);
  v_pe := GREATEST(v_pr, v_pe - v_legendary_bonus);

  v_roll := floor(random() * 100)::int;
  IF v_roll < v_pc THEN v_rarity := 'common';
  ELSIF v_roll < v_pr THEN v_rarity := 'rare';
  ELSIF v_roll < v_pe THEN v_rarity := 'epic';
  ELSE v_rarity := 'legendary'; END IF;

  IF v_rarity IN ('epic','legendary') AND random() < 0.30 THEN
    v_award_frame := true;
  END IF;

  IF v_award_frame THEN
    SELECT * INTO v_frame FROM public.avatar_frames
     WHERE rarity = v_rarity ORDER BY random() LIMIT 1;
    IF FOUND THEN
      SELECT EXISTS(SELECT 1 FROM public.user_frame_inventory
        WHERE user_id = _user_id AND frame_key = v_frame.frame_key) INTO v_already_has_frame;
      UPDATE public.user_gacha_tickets SET used=true, used_at=now() WHERE id = v_ticket.id;
      IF v_already_has_frame THEN
        UPDATE public.user_avatars SET coins = coins + v_frame_dup_coins, updated_at = now() WHERE user_id = _user_id;
        INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_key, reward_amount, rarity, ticket_id)
          VALUES (_user_id, _result_date, 'frame_dup', v_frame.frame_key, v_frame_dup_coins, v_rarity, v_ticket.id);
      ELSE
        INSERT INTO public.user_frame_inventory (user_id, frame_key, obtained_via)
          VALUES (_user_id, v_frame.frame_key, 'gacha');
        INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_key, reward_amount, rarity, ticket_id)
          VALUES (_user_id, _result_date, 'frame', v_frame.frame_key, 0, v_rarity, v_ticket.id);
      END IF;
      SELECT COUNT(*) INTO v_remaining FROM public.user_gacha_tickets WHERE user_id = _user_id AND used = false;
      RETURN jsonb_build_object(
        'no_ticket', false,
        'reward_type', CASE WHEN v_already_has_frame THEN 'frame_dup' ELSE 'frame' END,
        'reward_amount', CASE WHEN v_already_has_frame THEN v_frame_dup_coins ELSE 0 END,
        'frame_key', v_frame.frame_key,
        'frame_name', v_frame.frame_name,
        'frame_image', v_frame.image_path,
        'is_duplicate', v_already_has_frame,
        'rarity', v_rarity,
        'remaining', v_remaining,
        'legendary_bonus', v_legendary_bonus
      );
    END IF;
  END IF;

  -- Equipment drop on epic (30% after frame check)
  IF v_rarity = 'epic' AND random() < 0.30 THEN
    v_eq_pool := ARRAY['flame_guard','star_pendant'];
    v_eq_key := v_eq_pool[1 + floor(random() * array_length(v_eq_pool, 1))::int];
    SELECT * INTO v_eq FROM public.equipment_items WHERE item_key = v_eq_key;
    IF FOUND THEN
      SELECT EXISTS(
        SELECT 1 FROM public.user_equipment WHERE user_id = _user_id AND item_id = v_eq.id
      ) INTO v_eq_owned;
      UPDATE public.user_gacha_tickets SET used=true, used_at=now() WHERE id = v_ticket.id;
      INSERT INTO public.user_avatars (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

      IF v_eq_owned THEN
        UPDATE public.user_avatars SET coins = coins + v_eq_dup_coins, updated_at = now() WHERE user_id = _user_id;
        INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_key, reward_amount, rarity, ticket_id)
          VALUES (_user_id, _result_date, 'equipment_dup', v_eq_key, v_eq_dup_coins, v_rarity, v_ticket.id);
      ELSE
        PERFORM public.grant_equipment(_user_id, v_eq_key, 'gacha');
        INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_key, reward_amount, rarity, ticket_id)
          VALUES (_user_id, _result_date, 'equipment', v_eq_key, 0, v_rarity, v_ticket.id);
      END IF;

      SELECT COUNT(*) INTO v_remaining FROM public.user_gacha_tickets WHERE user_id = _user_id AND used = false;
      RETURN jsonb_build_object(
        'no_ticket', false,
        'reward_type', CASE WHEN v_eq_owned THEN 'equipment_dup' ELSE 'equipment' END,
        'reward_amount', CASE WHEN v_eq_owned THEN v_eq_dup_coins ELSE 0 END,
        'equipment_key', v_eq.item_key,
        'equipment_name', v_eq.item_name,
        'equipment_image', v_eq.image_path,
        'equipment_type', v_eq.item_type,
        'equipment_atk', v_eq.atk_bonus,
        'equipment_def', v_eq.def_bonus,
        'equipment_hp', v_eq.hp_bonus,
        'is_duplicate', v_eq_owned,
        'rarity', v_rarity,
        'remaining', v_remaining,
        'legendary_bonus', v_legendary_bonus
      );
    END IF;
  END IF;

  v_pool := CASE v_rarity
    WHEN 'common' THEN '[{"type":"coins","amount":5},{"type":"coins","amount":10},{"type":"exp","amount":20},{"type":"exp","amount":30}]'::jsonb
    WHEN 'rare' THEN '[{"type":"coins","amount":25},{"type":"coins","amount":30},{"type":"exp","amount":50},{"type":"exp","amount":75}]'::jsonb
    WHEN 'epic' THEN '[{"type":"coins","amount":50},{"type":"coins","amount":75},{"type":"exp","amount":100}]'::jsonb
    ELSE '[{"type":"coins","amount":150},{"type":"coins","amount":200},{"type":"exp","amount":200}]'::jsonb
  END;

  v_idx := floor(random() * jsonb_array_length(v_pool))::int;
  v_reward := v_pool -> v_idx;

  UPDATE public.user_gacha_tickets SET used=true, used_at=now() WHERE id = v_ticket.id;

  INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_amount, rarity, ticket_id)
    VALUES (_user_id, _result_date, v_reward->>'type', (v_reward->>'amount')::int, v_rarity, v_ticket.id);

  INSERT INTO public.user_avatars (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

  IF v_reward->>'type' = 'coins' THEN
    UPDATE public.user_avatars SET coins = coins + (v_reward->>'amount')::int, updated_at = now() WHERE user_id = _user_id;
  ELSE
    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
      VALUES (_user_id, (v_reward->>'amount')::int, 'gacha|' || v_ticket.id::text, _result_date);
    SELECT level INTO v_old_level FROM public.user_avatars WHERE user_id = _user_id;
    SELECT COALESCE(SUM(exp_amount),0) INTO v_total_exp FROM public.avatar_exp_logs WHERE user_id = _user_id;
    WHILE v_lvl < 999 LOOP
      v_required := 250 + v_lvl * 50;
      EXIT WHEN v_total_exp < v_cumulative + v_required;
      v_cumulative := v_cumulative + v_required;
      v_lvl := v_lvl + 1;
    END LOOP;
    v_new_level := v_lvl;
    v_added_coins := GREATEST(0, v_new_level - COALESCE(v_old_level,1)) * 10;
    UPDATE public.user_avatars
      SET total_exp = v_total_exp, level = v_new_level,
          coins = coins + v_added_coins, updated_at = now()
      WHERE user_id = _user_id;
  END IF;

  SELECT COUNT(*) INTO v_remaining FROM public.user_gacha_tickets WHERE user_id = _user_id AND used = false;

  RETURN jsonb_build_object(
    'no_ticket', false,
    'reward_type', v_reward->>'type',
    'reward_amount', (v_reward->>'amount')::int,
    'rarity', v_rarity,
    'remaining', v_remaining,
    'legendary_bonus', v_legendary_bonus
  );
END;
$function$;
