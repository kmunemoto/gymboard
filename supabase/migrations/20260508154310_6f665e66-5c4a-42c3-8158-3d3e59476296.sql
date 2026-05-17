
-- ===================== QUEST BOSS BATTLE SYSTEM =====================

-- 1. quest_bosses (master)
CREATE TABLE public.quest_bosses (
  id SERIAL PRIMARY KEY,
  stage_id INTEGER NOT NULL UNIQUE REFERENCES public.quest_stages(id) ON DELETE CASCADE,
  boss_name TEXT NOT NULL,
  boss_hp INTEGER NOT NULL,
  boss_atk INTEGER NOT NULL,
  boss_def INTEGER NOT NULL,
  boss_description TEXT NOT NULL,
  boss_icon TEXT NOT NULL DEFAULT 'Skull',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.quest_bosses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed can read bosses" ON public.quest_bosses FOR SELECT TO authenticated USING (true);

-- 2. equipment_items (master)
CREATE TABLE public.equipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('weapon','shield','amulet')),
  rarity TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
  atk_bonus INTEGER NOT NULL DEFAULT 0,
  def_bonus INTEGER NOT NULL DEFAULT 0,
  hp_bonus INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  icon_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.equipment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authed can read equipment" ON public.equipment_items FOR SELECT TO authenticated USING (true);

-- 3. user_equipment
CREATE TABLE public.user_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES public.equipment_items(id) ON DELETE CASCADE,
  equipped BOOLEAN NOT NULL DEFAULT false,
  obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, item_id)
);
CREATE INDEX idx_user_equipment_user ON public.user_equipment(user_id);
ALTER TABLE public.user_equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner read equipment" ON public.user_equipment FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(),'trainer'::app_role));
CREATE POLICY "Owner insert equipment" ON public.user_equipment FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner update equipment" ON public.user_equipment FOR UPDATE USING (auth.uid() = user_id);

-- 4. user_quest_boss_progress
CREATE TABLE public.user_quest_boss_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stage_id INTEGER NOT NULL REFERENCES public.quest_stages(id) ON DELETE CASCADE,
  boss_current_hp INTEGER NOT NULL,
  total_damage_dealt INTEGER NOT NULL DEFAULT 0,
  total_turns INTEGER NOT NULL DEFAULT 0,
  defeated BOOLEAN NOT NULL DEFAULT false,
  defeated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, stage_id)
);
CREATE INDEX idx_uqbp_user ON public.user_quest_boss_progress(user_id);
ALTER TABLE public.user_quest_boss_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner read boss progress" ON public.user_quest_boss_progress FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(),'trainer'::app_role));

-- 5. quest_battle_logs
CREATE TABLE public.quest_battle_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stage_id INTEGER NOT NULL REFERENCES public.quest_stages(id) ON DELETE CASCADE,
  session_volume NUMERIC NOT NULL DEFAULT 0,
  player_atk INTEGER NOT NULL,
  player_def INTEGER NOT NULL,
  player_hp INTEGER NOT NULL,
  boss_atk INTEGER NOT NULL,
  boss_def INTEGER NOT NULL,
  damage_dealt INTEGER NOT NULL,
  boss_counter_damage INTEGER NOT NULL,
  is_full_power BOOLEAN NOT NULL,
  boss_hp_before INTEGER NOT NULL,
  boss_hp_after INTEGER NOT NULL,
  is_boss_defeated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_qbl_user_stage ON public.quest_battle_logs(user_id, stage_id, created_at DESC);
ALTER TABLE public.quest_battle_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner read battle logs" ON public.quest_battle_logs FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(),'trainer'::app_role));

-- ===================== SEED MASTER DATA =====================
INSERT INTO public.quest_bosses (stage_id, boss_name, boss_hp, boss_atk, boss_def, boss_description, boss_icon) VALUES
  (1,'崩門のゴーレム',500,8,3,'崩れた城門を守る石の巨人。動きは鈍いが一撃は重い。','Bot'),
  (2,'枯園のツタ獣',1500,15,8,'枯れた庭園に巣食う植物の魔獣。無数のツタで絡みついてくる。','Bug'),
  (3,'氷港のセイレーン',3000,25,15,'港を氷で閉ざした海の魔女。冷気が全身を蝕む。','Snowflake'),
  (4,'灰街の炎魔人',6000,35,20,'職人の街を灰に変えた炎の化身。近づくだけで焼かれる。','Flame'),
  (5,'呪森の大蛇',10000,50,30,'精霊の森を呪いで汚した巨大な蛇。毒の霧を纏っている。','Worm'),
  (6,'闇塔の魔導士',18000,70,40,'星見の塔を乗っ取った闇の魔導士。強力な魔法を操る。','Wand2'),
  (7,'嵐崖の巨人',30000,90,55,'天空への道を阻む嵐の巨人。雷を自在に呼び寄せる。','CloudLightning'),
  (8,'闇の王',50000,120,70,'王国を闇に落とした全ての元凶。圧倒的な闇の力を持つ。','Skull');

INSERT INTO public.equipment_items (item_key,item_name,item_type,rarity,atk_bonus,def_bonus,hp_bonus,source,icon_name) VALUES
  ('wooden_sword','木の剣','weapon','common',3,0,0,'初期装備','Sword'),
  ('leather_shield','革の盾','shield','common',0,3,0,'初期装備','Shield'),
  ('stone_amulet','石の護符','amulet','common',0,0,20,'初期装備','Gem'),
  ('goblin_blade','ゴブリンスレイヤー','weapon','rare',8,0,0,'レイド：ゴブリン','Sword'),
  ('orc_axe','オークの戦斧','weapon','epic',15,0,0,'レイド：オーク戦士','Axe'),
  ('dragon_fang','ドラゴンの牙剣','weapon','legendary',25,0,0,'レイド：ドラゴン','Swords'),
  ('ice_shield','氷のシールド','shield','rare',0,8,0,'クエスト：ステージ3','ShieldCheck'),
  ('flame_guard','炎の守護盾','shield','epic',0,15,0,'クエスト：ステージ5','ShieldAlert'),
  ('storm_barrier','嵐の障壁','shield','legendary',0,25,0,'クエスト：ステージ7','ShieldPlus'),
  ('forest_charm','森の護符','amulet','rare',0,0,50,'クエスト：ステージ4','TreePine'),
  ('star_pendant','星のペンダント','amulet','epic',0,0,100,'クエスト：ステージ6','Star'),
  ('crown_of_light','光の王冠','amulet','legendary',5,5,150,'クエスト：ステージ8','Crown');

-- ===================== RPC FUNCTIONS =====================

-- get_player_combat_stats
CREATE OR REPLACE FUNCTION public.get_player_combat_stats(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID;
  v_level INT;
  v_base_hp INT; v_base_atk INT; v_base_def INT;
  v_w JSONB := NULL; v_s JSONB := NULL; v_a JSONB := NULL;
  v_atk_bonus INT := 0; v_def_bonus INT := 0; v_hp_bonus INT := 0;
  r RECORD;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;

  SELECT COALESCE(level,1) INTO v_level FROM public.user_avatars WHERE user_id = v_user;
  v_level := COALESCE(v_level, 1);
  v_base_hp := 100 + v_level * 5;
  v_base_atk := 10 + v_level * 2;
  v_base_def := 5 + v_level * 1;

  FOR r IN
    SELECT i.* FROM public.user_equipment ue
    JOIN public.equipment_items i ON i.id = ue.item_id
    WHERE ue.user_id = v_user AND ue.equipped = true
  LOOP
    v_atk_bonus := v_atk_bonus + r.atk_bonus;
    v_def_bonus := v_def_bonus + r.def_bonus;
    v_hp_bonus := v_hp_bonus + r.hp_bonus;
    IF r.item_type = 'weapon' THEN
      v_w := jsonb_build_object('id',r.id,'item_key',r.item_key,'item_name',r.item_name,'rarity',r.rarity,'atk_bonus',r.atk_bonus,'def_bonus',r.def_bonus,'hp_bonus',r.hp_bonus,'icon_name',r.icon_name);
    ELSIF r.item_type = 'shield' THEN
      v_s := jsonb_build_object('id',r.id,'item_key',r.item_key,'item_name',r.item_name,'rarity',r.rarity,'atk_bonus',r.atk_bonus,'def_bonus',r.def_bonus,'hp_bonus',r.hp_bonus,'icon_name',r.icon_name);
    ELSE
      v_a := jsonb_build_object('id',r.id,'item_key',r.item_key,'item_name',r.item_name,'rarity',r.rarity,'atk_bonus',r.atk_bonus,'def_bonus',r.def_bonus,'hp_bonus',r.hp_bonus,'icon_name',r.icon_name);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'level', v_level,
    'base_hp', v_base_hp, 'base_atk', v_base_atk, 'base_def', v_base_def,
    'total_hp', v_base_hp + v_hp_bonus,
    'total_atk', v_base_atk + v_atk_bonus,
    'total_def', v_base_def + v_def_bonus,
    'equipped_weapon', v_w,
    'equipped_shield', v_s,
    'equipped_amulet', v_a
  );
END $$;

-- equip_item
CREATE OR REPLACE FUNCTION public.equip_item(p_user_id UUID, p_item_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user UUID; v_owned BOOLEAN; v_type TEXT;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
  IF v_user <> auth.uid() AND NOT has_role(auth.uid(),'trainer'::app_role) THEN RAISE EXCEPTION '権限がありません'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.user_equipment WHERE user_id=v_user AND item_id=p_item_id) INTO v_owned;
  IF NOT v_owned THEN RAISE EXCEPTION 'アイテム未所持'; END IF;

  SELECT item_type INTO v_type FROM public.equipment_items WHERE id = p_item_id;

  UPDATE public.user_equipment SET equipped = false
  WHERE user_id = v_user AND item_id IN (SELECT id FROM public.equipment_items WHERE item_type = v_type);

  UPDATE public.user_equipment SET equipped = true
  WHERE user_id = v_user AND item_id = p_item_id;

  RETURN jsonb_build_object('equipped', true, 'item_type', v_type);
END $$;

-- execute_quest_battle
CREATE OR REPLACE FUNCTION public.execute_quest_battle(p_user_id UUID, p_session_volume NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;

  SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user;
  IF NOT FOUND THEN
    INSERT INTO public.user_quest_progress (user_id) VALUES (v_user) ON CONFLICT DO NOTHING;
    SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user;
  END IF;

  IF v_progress.current_stage > 8 THEN
    RETURN jsonb_build_object('all_complete', true);
  END IF;

  SELECT * INTO v_stage FROM public.quest_stages WHERE stage_number = v_progress.current_stage;
  SELECT * INTO v_boss FROM public.quest_bosses WHERE stage_id = v_stage.id;

  -- Ensure boss progress
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

  -- Player stats
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

  -- Rewards on defeat
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

    -- Equipment rewards by stage
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

    -- Advance stage
    UPDATE public.user_quest_progress
    SET current_stage = LEAST(v_stage.stage_number + 1, 9), updated_at = now()
    WHERE user_id = v_user;

    -- Pre-create next boss progress
    IF v_stage.stage_number < 8 THEN
      INSERT INTO public.user_quest_boss_progress (user_id, stage_id, boss_current_hp)
      SELECT v_user, s.id, b.boss_hp
      FROM public.quest_stages s JOIN public.quest_bosses b ON b.stage_id = s.id
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
END $$;

-- initialize_quest_boss_progress (trainer)
CREATE OR REPLACE FUNCTION public.initialize_quest_boss_progress()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_users INT := 0; v_progress INT := 0; v_equip INT := 0;
  u RECORD;
  v_starter_keys TEXT[] := ARRAY['wooden_sword','leather_shield','stone_amulet'];
  v_key TEXT; v_item_id UUID;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(),'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  FOR u IN SELECT user_id FROM public.profiles LOOP
    v_users := v_users + 1;
    -- Ensure quest progress
    INSERT INTO public.user_quest_progress (user_id) VALUES (u.user_id) ON CONFLICT DO NOTHING;
    -- Create boss progress for current stage
    INSERT INTO public.user_quest_boss_progress (user_id, stage_id, boss_current_hp)
    SELECT u.user_id, s.id, b.boss_hp
    FROM public.user_quest_progress qp
    JOIN public.quest_stages s ON s.stage_number = qp.current_stage
    JOIN public.quest_bosses b ON b.stage_id = s.id
    WHERE qp.user_id = u.user_id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_progress = ROW_COUNT;
    -- Grant + auto-equip starter items
    FOREACH v_key IN ARRAY v_starter_keys LOOP
      SELECT id INTO v_item_id FROM public.equipment_items WHERE item_key = v_key;
      INSERT INTO public.user_equipment (user_id, item_id, equipped)
      VALUES (u.user_id, v_item_id, true)
      ON CONFLICT (user_id, item_id) DO NOTHING;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('users', v_users);
END $$;

-- Trigger: keep updated_at fresh
CREATE TRIGGER trg_uqbp_updated BEFORE UPDATE ON public.user_quest_boss_progress
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
