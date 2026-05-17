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
  v_eq record;
  v_eq_owned boolean;
  v_eq_dup_coins integer;
  v_eq_drop_chance numeric;
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

  v_eq_drop_chance := CASE v_rarity
    WHEN 'common'    THEN 0.25
    WHEN 'rare'      THEN 0.30
    WHEN 'epic'      THEN 0.35
    WHEN 'legendary' THEN 0.40
  END;

  IF random() < v_eq_drop_chance THEN
    SELECT * INTO v_eq FROM public.equipment_items
     WHERE source = 'ガチャ' AND rarity = v_rarity
     ORDER BY random() LIMIT 1;

    IF FOUND THEN
      v_eq_dup_coins := CASE v_rarity
        WHEN 'common'    THEN 10
        WHEN 'rare'      THEN 30
        WHEN 'epic'      THEN 75
        WHEN 'legendary' THEN 200
      END;

      SELECT EXISTS(
        SELECT 1 FROM public.user_equipment WHERE user_id = _user_id AND item_id = v_eq.id
      ) INTO v_eq_owned;

      UPDATE public.user_gacha_tickets SET used=true, used_at=now() WHERE id = v_ticket.id;
      INSERT INTO public.user_avatars (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

      IF v_eq_owned THEN
        UPDATE public.user_avatars SET coins = coins + v_eq_dup_coins, updated_at = now() WHERE user_id = _user_id;
        INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_key, reward_amount, rarity, ticket_id)
          VALUES (_user_id, _result_date, 'equipment_dup', v_eq.item_key, v_eq_dup_coins, v_rarity, v_ticket.id);
      ELSE
        PERFORM public.grant_equipment(_user_id, v_eq.item_key, 'gacha');
        INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_key, reward_amount, rarity, ticket_id)
          VALUES (_user_id, _result_date, 'equipment', v_eq.item_key, 0, v_rarity, v_ticket.id);
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
    WHEN 'common'    THEN '[{"type":"coins","amount":5},{"type":"coins","amount":10},{"type":"exp","amount":20},{"type":"exp","amount":30}]'::jsonb
    WHEN 'rare'      THEN '[{"type":"coins","amount":20},{"type":"coins","amount":30},{"type":"exp","amount":60},{"type":"exp","amount":80}]'::jsonb
    WHEN 'epic'      THEN '[{"type":"coins","amount":50},{"type":"coins","amount":75},{"type":"exp","amount":150},{"type":"exp","amount":200}]'::jsonb
    WHEN 'legendary' THEN '[{"type":"coins","amount":150},{"type":"coins","amount":200},{"type":"exp","amount":400},{"type":"exp","amount":500}]'::jsonb
  END;

  v_idx := 1 + floor(random() * jsonb_array_length(v_pool))::int;
  v_reward := v_pool -> (v_idx - 1);

  UPDATE public.user_gacha_tickets SET used=true, used_at=now() WHERE id = v_ticket.id;
  INSERT INTO public.user_avatars (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;

  IF (v_reward->>'type') = 'coins' THEN
    v_added_coins := (v_reward->>'amount')::int;
    UPDATE public.user_avatars SET coins = coins + v_added_coins, updated_at = now() WHERE user_id = _user_id;
  ELSE
    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
      VALUES (_user_id, (v_reward->>'amount')::int, 'gacha|' || v_ticket.id::text, _result_date);
    SELECT COALESCE(SUM(exp_amount),0) INTO v_total_exp FROM public.avatar_exp_logs WHERE user_id = _user_id;
    SELECT level INTO v_old_level FROM public.user_avatars WHERE user_id = _user_id;
    LOOP
      v_required := 250 + v_lvl * 50;
      IF v_total_exp < v_cumulative + v_required OR v_lvl > 999 THEN EXIT; END IF;
      v_cumulative := v_cumulative + v_required;
      v_lvl := v_lvl + 1;
    END LOOP;
    v_new_level := v_lvl;
    UPDATE public.user_avatars SET total_exp = v_total_exp, level = v_new_level, updated_at = now() WHERE user_id = _user_id;
  END IF;

  INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_amount, rarity, ticket_id)
    VALUES (_user_id, _result_date, v_reward->>'type', (v_reward->>'amount')::int, v_rarity, v_ticket.id);

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