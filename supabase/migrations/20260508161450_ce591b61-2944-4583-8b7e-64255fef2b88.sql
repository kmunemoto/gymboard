-- 1. Add gender column to quest_bosses (default male to keep existing rows)
ALTER TABLE public.quest_bosses
  ADD COLUMN gender TEXT NOT NULL DEFAULT 'male'
    CHECK (gender IN ('male','female'));

-- 2. Replace unique constraint
ALTER TABLE public.quest_bosses DROP CONSTRAINT IF EXISTS quest_bosses_stage_id_key;
ALTER TABLE public.quest_bosses ADD CONSTRAINT quest_bosses_stage_gender_key UNIQUE (stage_id, gender);

-- 3. Ensure male values match spec (they already do, idempotent)
UPDATE public.quest_bosses SET boss_hp=500,   boss_atk=8,   boss_def=3  WHERE stage_id=1 AND gender='male';
UPDATE public.quest_bosses SET boss_hp=1500,  boss_atk=15,  boss_def=8  WHERE stage_id=2 AND gender='male';
UPDATE public.quest_bosses SET boss_hp=3000,  boss_atk=25,  boss_def=15 WHERE stage_id=3 AND gender='male';
UPDATE public.quest_bosses SET boss_hp=6000,  boss_atk=35,  boss_def=20 WHERE stage_id=4 AND gender='male';
UPDATE public.quest_bosses SET boss_hp=10000, boss_atk=50,  boss_def=30 WHERE stage_id=5 AND gender='male';
UPDATE public.quest_bosses SET boss_hp=18000, boss_atk=70,  boss_def=40 WHERE stage_id=6 AND gender='male';
UPDATE public.quest_bosses SET boss_hp=30000, boss_atk=90,  boss_def=55 WHERE stage_id=7 AND gender='male';
UPDATE public.quest_bosses SET boss_hp=50000, boss_atk=120, boss_def=70 WHERE stage_id=8 AND gender='male';

-- 4. Insert female counterparts (same name/icon/description)
INSERT INTO public.quest_bosses (stage_id, gender, boss_name, boss_hp, boss_atk, boss_def, boss_icon, boss_description)
SELECT stage_id, 'female', boss_name, 
  CASE stage_id WHEN 1 THEN 250 WHEN 2 THEN 800 WHEN 3 THEN 1600 WHEN 4 THEN 3200 WHEN 5 THEN 5500 WHEN 6 THEN 10000 WHEN 7 THEN 16000 WHEN 8 THEN 27000 END,
  CASE stage_id WHEN 1 THEN 5   WHEN 2 THEN 10  WHEN 3 THEN 15   WHEN 4 THEN 20   WHEN 5 THEN 30   WHEN 6 THEN 40    WHEN 7 THEN 55    WHEN 8 THEN 70    END,
  CASE stage_id WHEN 1 THEN 2   WHEN 2 THEN 5   WHEN 3 THEN 8    WHEN 4 THEN 12   WHEN 5 THEN 18   WHEN 6 THEN 25    WHEN 7 THEN 33    WHEN 8 THEN 42    END,
  boss_icon, boss_description
FROM public.quest_bosses
WHERE gender='male'
ON CONFLICT (stage_id, gender) DO NOTHING;

-- 5. Update execute_quest_battle to use gender-specific boss
CREATE OR REPLACE FUNCTION public.execute_quest_battle(p_user_id uuid, p_session_volume numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID; v_progress RECORD; v_stage RECORD; v_boss RECORD; v_bp RECORD;
  v_stats JSONB;
  v_atk INT; v_def INT; v_hp INT;
  v_vol_mult NUMERIC; v_raw_dmg INT; v_counter INT; v_is_full BOOL; v_final_dmg INT;
  v_hp_before INT; v_hp_after INT;
  v_defeated BOOL := false;
  v_rewards JSONB := '{}'::jsonb;
  v_total_exp INT; v_old_level INT; v_new_level INT; v_required INT; v_cum INT := 0; v_lvl INT := 1; v_added_coins INT := 0;
  v_reward_item_key TEXT; v_reward_item_id UUID;
  v_gender TEXT;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;

  SELECT COALESCE(NULLIF(gender,''), 'female') INTO v_gender FROM public.user_avatars WHERE user_id = v_user;
  IF v_gender IS NULL OR v_gender NOT IN ('male','female') THEN v_gender := 'female'; END IF;

  SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user;
  IF NOT FOUND THEN
    INSERT INTO public.user_quest_progress (user_id) VALUES (v_user) ON CONFLICT DO NOTHING;
    SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user;
  END IF;

  IF v_progress.current_stage > 8 THEN
    RETURN jsonb_build_object('all_complete', true);
  END IF;

  SELECT * INTO v_stage FROM public.quest_stages WHERE stage_number = v_progress.current_stage;
  SELECT * INTO v_boss FROM public.quest_bosses WHERE stage_id = v_stage.id AND gender = v_gender;
  IF NOT FOUND THEN
    SELECT * INTO v_boss FROM public.quest_bosses WHERE stage_id = v_stage.id AND gender = 'female';
  END IF;

  SELECT * INTO v_bp FROM public.user_quest_boss_progress WHERE user_id = v_user AND stage_id = v_stage.id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_quest_boss_progress (user_id, stage_id, boss_current_hp)
    VALUES (v_user, v_stage.id, v_boss.boss_hp)
    ON CONFLICT (user_id, stage_id) DO NOTHING;
    SELECT * INTO v_bp FROM public.user_quest_boss_progress WHERE user_id = v_user AND stage_id = v_stage.id FOR UPDATE;
  END IF;

  IF v_bp.defeated THEN
    RETURN jsonb_build_object('already_defeated', true);
  END IF;

  v_stats := public.get_player_combat_stats(v_user);
  v_atk := (v_stats->>'total_atk')::int;
  v_def := (v_stats->>'total_def')::int;
  v_hp := (v_stats->>'total_hp')::int;

  v_vol_mult := 1 + (COALESCE(p_session_volume,0) / 5000.0);
  v_raw_dmg := GREATEST(1, v_atk - v_boss.boss_def);
  v_counter := GREATEST(1, v_boss.boss_atk - v_def);
  v_is_full := v_hp >= v_counter;
  v_final_dmg := CASE WHEN v_is_full
    THEN ROUND(v_raw_dmg * v_vol_mult)
    ELSE ROUND(v_raw_dmg * v_vol_mult * 0.5)
  END::int;
  v_final_dmg := GREATEST(1, v_final_dmg);

  v_hp_before := v_bp.boss_current_hp;
  v_hp_after := GREATEST(0, v_hp_before - v_final_dmg);
  v_defeated := v_hp_after = 0;

  UPDATE public.user_quest_boss_progress
  SET boss_current_hp = v_hp_after,
      total_damage_dealt = total_damage_dealt + v_final_dmg,
      total_turns = total_turns + 1,
      defeated = v_defeated,
      defeated_at = CASE WHEN v_defeated THEN now() ELSE defeated_at END,
      updated_at = now()
  WHERE id = v_bp.id;

  INSERT INTO public.quest_battle_logs (
    user_id, stage_id, session_volume, player_atk, player_def, player_hp,
    boss_atk, boss_def, damage_dealt, boss_counter_damage, is_full_power,
    boss_hp_before, boss_hp_after, is_boss_defeated
  ) VALUES (
    v_user, v_stage.id, COALESCE(p_session_volume,0), v_atk, v_def, v_hp,
    v_boss.boss_atk, v_boss.boss_def, v_final_dmg, v_counter, v_is_full,
    v_hp_before, v_hp_after, v_defeated
  );

  IF v_defeated THEN
    INSERT INTO public.user_quest_stage_completions (user_id, stage_id) VALUES (v_user, v_stage.id) ON CONFLICT DO NOTHING;
    INSERT INTO public.user_avatars (user_id) VALUES (v_user) ON CONFLICT DO NOTHING;
    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
    VALUES (v_user, v_stage.reward_exp, 'quest_stage|' || v_stage.id::text, CURRENT_DATE)
    ON CONFLICT DO NOTHING;

    SELECT level INTO v_old_level FROM public.user_avatars WHERE user_id = v_user;
    SELECT COALESCE(SUM(exp_amount),0) INTO v_total_exp FROM public.avatar_exp_logs WHERE user_id = v_user;
    WHILE v_lvl < 999 LOOP
      v_required := 250 + v_lvl * 50;
      EXIT WHEN v_total_exp < v_cum + v_required;
      v_cum := v_cum + v_required;
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
      INSERT INTO public.user_titles (user_id, title_key) VALUES (v_user, v_stage.reward_title) ON CONFLICT DO NOTHING;
    END IF;
    IF v_stage.reward_badge_key IS NOT NULL THEN
      INSERT INTO public.avatar_achievements (user_id, achievement_key) VALUES (v_user, v_stage.reward_badge_key) ON CONFLICT DO NOTHING;
    END IF;
    IF v_stage.reward_frame THEN
      UPDATE public.user_avatars SET equipped_frame = COALESCE(equipped_frame, 'quest_kingdom_hero'), updated_at = now() WHERE user_id = v_user;
    END IF;

    v_reward_item_key := CASE v_stage.stage_number
      WHEN 3 THEN 'ice_shield'
      WHEN 4 THEN 'forest_charm'
      WHEN 5 THEN 'flame_guard'
      WHEN 6 THEN 'star_pendant'
      WHEN 7 THEN 'storm_barrier'
      WHEN 8 THEN 'crown_of_light'
      ELSE NULL END;
    IF v_reward_item_key IS NOT NULL THEN
      SELECT id INTO v_reward_item_id FROM public.equipment_items WHERE item_key = v_reward_item_key;
      IF v_reward_item_id IS NOT NULL THEN
        INSERT INTO public.user_equipment (user_id, item_id) VALUES (v_user, v_reward_item_id) ON CONFLICT DO NOTHING;
      END IF;
    END IF;

    UPDATE public.user_quest_progress
    SET current_stage = LEAST(v_stage.stage_number + 1, 9), updated_at = now()
    WHERE user_id = v_user;

    IF v_stage.stage_number < 8 THEN
      INSERT INTO public.user_quest_boss_progress (user_id, stage_id, boss_current_hp)
      SELECT v_user, s.id, b.boss_hp
      FROM public.quest_stages s
      JOIN public.quest_bosses b ON b.stage_id = s.id AND b.gender = v_gender
      WHERE s.stage_number = v_stage.stage_number + 1
      ON CONFLICT DO NOTHING;
    END IF;

    v_rewards := jsonb_build_object(
      'coins', v_stage.reward_coins,
      'exp', v_stage.reward_exp,
      'title', v_stage.reward_title,
      'badge_key', v_stage.reward_badge_key,
      'frame', v_stage.reward_frame,
      'equipment_key', v_reward_item_key,
      'leveled_up', v_new_level > COALESCE(v_old_level,1),
      'all_complete', v_stage.stage_number = 8
    );
  END IF;

  RETURN jsonb_build_object(
    'stage_id', v_stage.id,
    'stage_number', v_stage.stage_number,
    'boss_name', v_boss.boss_name,
    'boss_icon', v_boss.boss_icon,
    'boss_max_hp', v_boss.boss_hp,
    'boss_hp_before', v_hp_before,
    'boss_hp_after', v_hp_after,
    'damage_dealt', v_final_dmg,
    'boss_counter_damage', v_counter,
    'is_full_power', v_is_full,
    'is_boss_defeated', v_defeated,
    'volume_multiplier', v_vol_mult,
    'player_stats', jsonb_build_object('atk', v_atk, 'def', v_def, 'hp', v_hp),
    'rewards', v_rewards,
    'story_complete', CASE WHEN v_defeated THEN v_stage.story_complete ELSE NULL END
  );
END $function$;

-- 6. Update initialize_quest_boss_progress to use gender-specific HP
CREATE OR REPLACE FUNCTION public.initialize_quest_boss_progress()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_users INT := 0;
  u RECORD;
  v_starter_keys TEXT[] := ARRAY['wooden_sword','leather_shield','stone_amulet'];
  v_key TEXT; v_item_id UUID;
  v_gender TEXT;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(),'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  FOR u IN SELECT user_id FROM public.profiles LOOP
    v_users := v_users + 1;
    INSERT INTO public.user_quest_progress (user_id) VALUES (u.user_id) ON CONFLICT DO NOTHING;

    SELECT COALESCE(NULLIF(gender,''),'female') INTO v_gender FROM public.user_avatars WHERE user_id = u.user_id;
    IF v_gender IS NULL OR v_gender NOT IN ('male','female') THEN v_gender := 'female'; END IF;

    INSERT INTO public.user_quest_boss_progress (user_id, stage_id, boss_current_hp)
    SELECT u.user_id, s.id, b.boss_hp
    FROM public.user_quest_progress qp
    JOIN public.quest_stages s ON s.stage_number = qp.current_stage
    JOIN public.quest_bosses b ON b.stage_id = s.id AND b.gender = v_gender
    WHERE qp.user_id = u.user_id
    ON CONFLICT DO NOTHING;

    FOREACH v_key IN ARRAY v_starter_keys LOOP
      SELECT id INTO v_item_id FROM public.equipment_items WHERE item_key = v_key;
      INSERT INTO public.user_equipment (user_id, item_id, equipped)
      VALUES (u.user_id, v_item_id, true)
      ON CONFLICT (user_id, item_id) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('users', v_users);
END $function$;