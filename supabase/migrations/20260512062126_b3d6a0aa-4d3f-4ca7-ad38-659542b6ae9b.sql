DO $$
DECLARE
  v_rec record;
  v_exp int;
BEGIN
  FOR v_rec IN
    SELECT aa.user_id, aa.achievement_key, aa.unlocked_at
    FROM public.avatar_achievements aa
    WHERE NOT EXISTS (
      SELECT 1 FROM public.avatar_exp_logs el
      WHERE el.user_id = aa.user_id AND el.reason = 'badge|' || aa.achievement_key
    )
  LOOP
    IF v_rec.achievement_key IN (
      'volcano_conqueror', 'sky_champion', 'all_stages_clear',
      'no_damage_stage', 'close_call', 'boss_slayer_50',
      'dungeon_100', 'dungeon_streak_30',
      'learn_nova_burst', 'learn_luminas_ray',
      'star_collector',
      'title_star_guardian', 'title_luminas_heir', 'title_iron_wall', 'title_dungeon_master'
    ) THEN
      v_exp := 300;
    ELSIF v_rec.achievement_key IN (
      'ruins_explorer', 'swamp_survivor',
      'no_damage_floor', 'spell_master', 'overkill',
      'boss_slayer_10', 'dungeon_50', 'dungeon_streak_7',
      'companion_lv10',
      'learn_thunder_ray',
      'magic_collector', 'dragon_collector',
      'title_star_seeker'
    ) THEN
      v_exp := 150;
    ELSE
      v_exp := 50;
    END IF;

    IF v_rec.achievement_key LIKE 'title_%' THEN
      v_exp := v_exp + 500;
    END IF;

    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
    VALUES (v_rec.user_id, v_exp, 'badge|' || v_rec.achievement_key, CURRENT_DATE);
  END LOOP;
END $$;

DO $$
DECLARE
  v_user record;
  v_total integer;
  v_lvl integer;
  v_cum integer;
  v_req integer;
BEGIN
  FOR v_user IN SELECT DISTINCT user_id FROM public.avatar_exp_logs LOOP
    SELECT COALESCE(SUM(exp_amount), 0) INTO v_total
    FROM public.avatar_exp_logs WHERE user_id = v_user.user_id;

    v_lvl := 1;
    v_cum := 0;
    LOOP
      v_req := 250 + v_lvl * 50;
      IF v_total < v_cum + v_req OR v_lvl > 999 THEN EXIT; END IF;
      v_cum := v_cum + v_req;
      v_lvl := v_lvl + 1;
    END LOOP;

    UPDATE public.user_avatars
    SET total_exp = v_total, level = v_lvl, updated_at = now()
    WHERE user_id = v_user.user_id;
  END LOOP;
END $$;