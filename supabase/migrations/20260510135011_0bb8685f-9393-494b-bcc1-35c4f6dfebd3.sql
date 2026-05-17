-- ============================================
-- Solo Dungeon Exploration Part 1: Backend
-- ============================================

-- 1. dungeon_stages
CREATE TABLE public.dungeon_stages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  stage_key text UNIQUE NOT NULL,
  stage_name text NOT NULL,
  stage_order int NOT NULL,
  floor_count int NOT NULL DEFAULT 5,
  unlock_condition text DEFAULT NULL,
  background_css text DEFAULT 'linear-gradient(135deg, #1a1a2e, #16213e)',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dungeon_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read dungeon_stages" ON public.dungeon_stages FOR SELECT USING (true);

-- 2. dungeon_monsters
CREATE TABLE public.dungeon_monsters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  monster_key text UNIQUE NOT NULL,
  monster_name text NOT NULL,
  stage_key text NOT NULL REFERENCES public.dungeon_stages(stage_key),
  floor_number int NOT NULL,
  hp int NOT NULL,
  atk int NOT NULL,
  def int NOT NULL,
  exp_reward int NOT NULL DEFAULT 10,
  coin_reward int NOT NULL DEFAULT 5,
  is_boss boolean NOT NULL DEFAULT false,
  icon_name text DEFAULT 'Bug',
  drop_material_key text DEFAULT NULL,
  drop_material_rate numeric DEFAULT 0,
  drop_ticket_rate numeric DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dungeon_monsters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read dungeon_monsters" ON public.dungeon_monsters FOR SELECT USING (true);

-- 3. user_stamina (user_id = auth.users.id, matching pattern of other tables)
CREATE TABLE public.user_stamina (
  user_id uuid PRIMARY KEY,
  current_stamina int NOT NULL DEFAULT 5,
  max_stamina int NOT NULL DEFAULT 5,
  last_recovery_at timestamptz NOT NULL DEFAULT now(),
  bonus_stamina int NOT NULL DEFAULT 0,
  bonus_date date DEFAULT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_stamina ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own stamina" ON public.user_stamina FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users update own stamina" ON public.user_stamina FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users insert own stamina" ON public.user_stamina FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 4. dungeon_runs
CREATE TABLE public.dungeon_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  stage_key text NOT NULL REFERENCES public.dungeon_stages(stage_key),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz DEFAULT NULL,
  floors_cleared int NOT NULL DEFAULT 0,
  total_exp int NOT NULL DEFAULT 0,
  total_coins int NOT NULL DEFAULT 0,
  result text NOT NULL DEFAULT 'in_progress',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dungeon_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own runs" ON public.dungeon_runs FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own runs" ON public.dungeon_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own runs" ON public.dungeon_runs FOR UPDATE USING (auth.uid() = user_id);

-- 5. craft_materials
CREATE TABLE public.craft_materials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  material_key text UNIQUE NOT NULL,
  material_name text NOT NULL,
  rarity text NOT NULL DEFAULT 'common',
  icon_name text DEFAULT 'Gem',
  description text DEFAULT ''
);
ALTER TABLE public.craft_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read materials" ON public.craft_materials FOR SELECT USING (true);

-- 6. user_materials
CREATE TABLE public.user_materials (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  material_key text NOT NULL,
  quantity int NOT NULL DEFAULT 0,
  UNIQUE(user_id, material_key)
);
ALTER TABLE public.user_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own materials" ON public.user_materials FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own materials" ON public.user_materials FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own materials" ON public.user_materials FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- Initial data
-- ============================================

INSERT INTO public.craft_materials (material_key, material_name, rarity, icon_name, description) VALUES
('iron_ore', '鉄鉱石', 'common', 'Mountain', '洞窟や遺跡で採れる基本素材'),
('magic_stone', '魔石', 'rare', 'Gem', '魔力を帯びた神秘の石'),
('dragon_scale', '竜の鱗', 'epic', 'Shield', '強大な竜から剥ぎ取った鱗'),
('star_fragment', '星の欠片', 'legendary', 'Star', '天空から落ちた星の破片');

INSERT INTO public.dungeon_stages (stage_key, stage_name, stage_order, floor_count, unlock_condition, background_css) VALUES
('dark_cave', '闇の洞窟', 1, 5, NULL, 'linear-gradient(135deg, #1a1a2e, #2d1b4e)'),
('ancient_ruins', '古代遺跡', 2, 5, 'dark_cave', 'linear-gradient(135deg, #2c2c1a, #4a3f28)'),
('poison_swamp', '毒の沼地', 3, 5, 'ancient_ruins', 'linear-gradient(135deg, #1a2e1a, #2e4a2e)'),
('fire_volcano', '灼熱の火山', 4, 5, 'poison_swamp', 'linear-gradient(135deg, #3e1a1a, #5e2a0a)'),
('sky_tower', '天空の塔', 5, 5, 'fire_volcano', 'linear-gradient(135deg, #1a2e4e, #3a5e8e)');

INSERT INTO public.dungeon_monsters (monster_key, monster_name, stage_key, floor_number, hp, atk, def, exp_reward, coin_reward, is_boss, icon_name, drop_material_key, drop_material_rate, drop_ticket_rate) VALUES
('slime', 'スライム', 'dark_cave', 1, 30, 5, 2, 8, 3, false, 'Droplet', 'iron_ore', 0.3, 0),
('bat', 'コウモリ', 'dark_cave', 2, 40, 8, 3, 10, 5, false, 'Bird', 'iron_ore', 0.3, 0),
('goblin', 'ゴブリン', 'dark_cave', 3, 55, 10, 5, 15, 8, false, 'Skull', 'iron_ore', 0.4, 0),
('giant_spider', '大グモ', 'dark_cave', 4, 70, 12, 6, 20, 10, false, 'Bug', 'iron_ore', 0.4, 0),
('cave_troll', 'ケイブトロール', 'dark_cave', 5, 120, 18, 10, 50, 25, true, 'Angry', 'iron_ore', 0.8, 0.1),
('skeleton', 'スケルトン', 'ancient_ruins', 1, 50, 10, 5, 12, 6, false, 'Bone', 'iron_ore', 0.3, 0),
('mummy', 'ミイラ', 'ancient_ruins', 2, 65, 12, 8, 15, 8, false, 'PersonStanding', 'iron_ore', 0.3, 0),
('stone_golem', 'ストーンゴーレム', 'ancient_ruins', 3, 90, 14, 15, 20, 10, false, 'Box', 'magic_stone', 0.2, 0),
('curse_mage', '呪い師', 'ancient_ruins', 4, 75, 20, 6, 25, 12, false, 'Flame', 'magic_stone', 0.25, 0),
('pharaoh', 'ファラオ', 'ancient_ruins', 5, 180, 22, 12, 60, 30, true, 'Crown', 'magic_stone', 0.7, 0.1),
('poison_frog', '毒ガエル', 'poison_swamp', 1, 60, 12, 6, 15, 8, false, 'Frog', 'magic_stone', 0.2, 0),
('mud_snake', 'マッドスネーク', 'poison_swamp', 2, 80, 15, 8, 18, 10, false, 'Waves', 'magic_stone', 0.25, 0),
('swamp_spirit', '沼の精', 'poison_swamp', 3, 100, 18, 10, 22, 12, false, 'Ghost', 'magic_stone', 0.3, 0),
('rot_beast', '腐食獣', 'poison_swamp', 4, 120, 22, 12, 28, 15, false, 'Biohazard', 'magic_stone', 0.3, 0),
('hydra', 'ヒュドラ', 'poison_swamp', 5, 250, 28, 15, 80, 40, true, 'Scissors', 'dragon_scale', 0.3, 0.15),
('fire_lizard', 'ファイアリザード', 'fire_volcano', 1, 90, 18, 10, 20, 12, false, 'Flame', 'magic_stone', 0.25, 0),
('lava_worm', '溶岩蟲', 'fire_volcano', 2, 110, 22, 12, 25, 15, false, 'Worm', 'magic_stone', 0.3, 0),
('fire_spirit', '炎の精霊', 'fire_volcano', 3, 130, 25, 14, 30, 18, false, 'Sparkles', 'dragon_scale', 0.15, 0),
('salamander', 'サラマンダー', 'fire_volcano', 4, 160, 30, 16, 35, 20, false, 'Zap', 'dragon_scale', 0.2, 0),
('ifrit', 'イフリート', 'fire_volcano', 5, 350, 35, 20, 100, 50, true, 'Flame', 'dragon_scale', 0.6, 0.2),
('harpy', 'ハーピー', 'sky_tower', 1, 120, 22, 12, 25, 15, false, 'Bird', 'dragon_scale', 0.15, 0),
('griffon', 'グリフォン', 'sky_tower', 2, 150, 28, 16, 30, 18, false, 'Eagle', 'dragon_scale', 0.2, 0),
('wind_spirit', '風の精霊', 'sky_tower', 3, 180, 32, 18, 35, 22, false, 'Wind', 'star_fragment', 0.05, 0),
('thunderbird', 'サンダーバード', 'sky_tower', 4, 220, 38, 22, 45, 28, false, 'Zap', 'star_fragment', 0.08, 0),
('sky_dragon', '天空竜', 'sky_tower', 5, 500, 45, 28, 150, 80, true, 'Dragon', 'star_fragment', 0.3, 0.25);

-- ============================================
-- RPC functions
-- ============================================

CREATE OR REPLACE FUNCTION public.recover_stamina(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row user_stamina%ROWTYPE;
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'Asia/Tokyo')::date;
  v_hours numeric;
  v_recovered int;
  v_cap int;
BEGIN
  INSERT INTO public.user_stamina (user_id) VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_row FROM public.user_stamina WHERE user_id = p_user_id FOR UPDATE;

  -- Daily reset of bonus stamina
  IF v_row.bonus_date IS NULL OR v_row.bonus_date <> v_today THEN
    v_row.bonus_stamina := 0;
    v_row.bonus_date := v_today;
    UPDATE public.user_stamina
    SET bonus_stamina = 0, bonus_date = v_today, updated_at = v_now
    WHERE user_id = p_user_id;
  END IF;

  v_cap := v_row.max_stamina + v_row.bonus_stamina;
  v_hours := EXTRACT(EPOCH FROM (v_now - v_row.last_recovery_at)) / 3600.0;
  v_recovered := FLOOR(v_hours / 4.0)::int;

  IF v_recovered > 0 AND v_row.current_stamina < v_cap THEN
    v_row.current_stamina := LEAST(v_row.current_stamina + v_recovered, v_cap);
    v_row.last_recovery_at := v_row.last_recovery_at + (v_recovered * interval '4 hours');
    UPDATE public.user_stamina
    SET current_stamina = v_row.current_stamina,
        last_recovery_at = v_row.last_recovery_at,
        updated_at = v_now
    WHERE user_id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'current_stamina', v_row.current_stamina,
    'max_stamina', v_cap,
    'bonus_stamina', v_row.bonus_stamina,
    'next_recovery_at', v_row.last_recovery_at + interval '4 hours'
  );
END; $$;

CREATE OR REPLACE FUNCTION public.start_dungeon_run(p_user_id uuid, p_stage_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stamina int;
  v_run_id uuid;
  v_stage record;
  v_prev_cleared boolean;
BEGIN
  PERFORM recover_stamina(p_user_id);
  SELECT current_stamina INTO v_stamina FROM public.user_stamina WHERE user_id = p_user_id;
  IF v_stamina IS NULL OR v_stamina < 1 THEN
    RETURN jsonb_build_object('error', 'スタミナが足りません');
  END IF;

  SELECT * INTO v_stage FROM public.dungeon_stages WHERE stage_key = p_stage_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'ステージが存在しません');
  END IF;

  IF v_stage.unlock_condition IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.dungeon_runs
      WHERE user_id = p_user_id AND stage_key = v_stage.unlock_condition AND result = 'victory'
    ) INTO v_prev_cleared;
    IF NOT v_prev_cleared THEN
      RETURN jsonb_build_object('error', '前のステージをクリアしてください');
    END IF;
  END IF;

  UPDATE public.user_stamina
  SET current_stamina = current_stamina - 1, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.dungeon_runs (user_id, stage_key)
  VALUES (p_user_id, p_stage_key)
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'stage_key', p_stage_key,
    'stage_name', v_stage.stage_name,
    'floor_count', v_stage.floor_count,
    'stamina_remaining', v_stamina - 1
  );
END; $$;

CREATE OR REPLACE FUNCTION public.complete_dungeon_run(
  p_run_id uuid,
  p_floors_cleared int,
  p_total_exp int,
  p_total_coins int,
  p_result text,
  p_dropped_materials jsonb DEFAULT '[]'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run record;
  v_mat jsonb;
BEGIN
  SELECT * INTO v_run FROM public.dungeon_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'run not found'); END IF;

  UPDATE public.dungeon_runs
  SET floors_cleared = p_floors_cleared,
      total_exp = p_total_exp,
      total_coins = p_total_coins,
      result = p_result,
      completed_at = now()
  WHERE id = p_run_id;

  INSERT INTO public.user_avatars (user_id) VALUES (v_run.user_id) ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.user_avatars
  SET coins = coins + p_total_coins, updated_at = now()
  WHERE user_id = v_run.user_id;

  IF p_total_exp > 0 THEN
    INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
    VALUES (v_run.user_id, p_total_exp, 'dungeon|' || p_run_id::text, CURRENT_DATE)
    ON CONFLICT DO NOTHING;
  END IF;

  FOR v_mat IN SELECT * FROM jsonb_array_elements(p_dropped_materials)
  LOOP
    INSERT INTO public.user_materials (user_id, material_key, quantity)
    VALUES (v_run.user_id, v_mat->>'key', (v_mat->>'qty')::int)
    ON CONFLICT (user_id, material_key) DO UPDATE SET quantity = user_materials.quantity + (v_mat->>'qty')::int;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'floors_cleared', p_floors_cleared,
    'total_exp', p_total_exp,
    'total_coins', p_total_coins,
    'result', p_result,
    'materials', p_dropped_materials
  );
END; $$;

-- ============================================
-- Training day stamina bonus
-- ============================================

CREATE OR REPLACE FUNCTION public.grant_training_stamina_bonus()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  INSERT INTO public.user_stamina (user_id, bonus_stamina, current_stamina, bonus_date)
  VALUES (NEW.user_id, 3, 5 + 3, v_today)
  ON CONFLICT (user_id) DO UPDATE
  SET bonus_stamina = 3,
      bonus_date = v_today,
      current_stamina = LEAST(user_stamina.current_stamina + 3, user_stamina.max_stamina + 3),
      updated_at = now();
  RETURN NEW;
END; $$;

-- Attach to bookings when status becomes '完了'
CREATE OR REPLACE FUNCTION public.trigger_training_bonus_on_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = '完了' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.grant_training_stamina_bonus_for(NEW.user_id);
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.grant_training_stamina_bonus_for(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  INSERT INTO public.user_stamina (user_id, bonus_stamina, current_stamina, bonus_date)
  VALUES (p_user_id, 3, 8, v_today)
  ON CONFLICT (user_id) DO UPDATE
  SET bonus_stamina = 3,
      bonus_date = v_today,
      current_stamina = LEAST(user_stamina.current_stamina + 3, user_stamina.max_stamina + 3),
      updated_at = now();
END; $$;

DROP TRIGGER IF EXISTS trg_bookings_training_stamina_bonus ON public.bookings;
CREATE TRIGGER trg_bookings_training_stamina_bonus
AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.trigger_training_bonus_on_booking();
