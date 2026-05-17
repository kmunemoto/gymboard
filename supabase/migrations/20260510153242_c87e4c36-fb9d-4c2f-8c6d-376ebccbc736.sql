
-- 1. player_skills
CREATE TABLE IF NOT EXISTS public.player_skills (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  skill_key text UNIQUE NOT NULL,
  skill_name text NOT NULL,
  skill_type text NOT NULL DEFAULT 'attack',
  mp_cost int NOT NULL DEFAULT 3,
  power numeric NOT NULL DEFAULT 1.0,
  heal_amount int DEFAULT NULL,
  buff_type text DEFAULT NULL,
  buff_multiplier numeric DEFAULT 1.0,
  buff_turns int DEFAULT 3,
  description text NOT NULL,
  required_level int NOT NULL DEFAULT 1,
  icon_name text DEFAULT 'Sparkles',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.player_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read skills" ON public.player_skills;
CREATE POLICY "Anyone can read skills" ON public.player_skills FOR SELECT USING (true);

-- 2. battle_items
CREATE TABLE IF NOT EXISTS public.battle_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  item_key text UNIQUE NOT NULL,
  item_name text NOT NULL,
  effect_type text NOT NULL,
  effect_amount int NOT NULL DEFAULT 30,
  description text NOT NULL,
  shop_price int DEFAULT NULL,
  icon_name text DEFAULT 'Package',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.battle_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read items" ON public.battle_items;
CREATE POLICY "Anyone can read items" ON public.battle_items FOR SELECT USING (true);

-- 3. user_battle_items
CREATE TABLE IF NOT EXISTS public.user_battle_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  item_key text NOT NULL,
  quantity int NOT NULL DEFAULT 0,
  UNIQUE(user_id, item_key)
);
ALTER TABLE public.user_battle_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own items" ON public.user_battle_items;
DROP POLICY IF EXISTS "Users upsert own items" ON public.user_battle_items;
DROP POLICY IF EXISTS "Users update own items" ON public.user_battle_items;
CREATE POLICY "Users read own items" ON public.user_battle_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users upsert own items" ON public.user_battle_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own items" ON public.user_battle_items FOR UPDATE USING (auth.uid() = user_id);

-- 4. user_companions
CREATE TABLE IF NOT EXISTS public.user_companions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  companion_key text NOT NULL,
  companion_name text NOT NULL,
  element text NOT NULL DEFAULT 'neutral',
  level int NOT NULL DEFAULT 1,
  exp int NOT NULL DEFAULT 0,
  base_atk int NOT NULL DEFAULT 5,
  base_def int NOT NULL DEFAULT 3,
  base_hp int NOT NULL DEFAULT 30,
  is_active boolean NOT NULL DEFAULT false,
  icon_name text DEFAULT 'Cat',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, companion_key)
);
ALTER TABLE public.user_companions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own companions" ON public.user_companions;
DROP POLICY IF EXISTS "Users insert own companions" ON public.user_companions;
DROP POLICY IF EXISTS "Users update own companions" ON public.user_companions;
CREATE POLICY "Users read own companions" ON public.user_companions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own companions" ON public.user_companions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own companions" ON public.user_companions FOR UPDATE USING (auth.uid() = user_id);

-- 5. dungeon_story
CREATE TABLE IF NOT EXISTS public.dungeon_story (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  stage_key text NOT NULL,
  timing text NOT NULL,
  speaker text DEFAULT NULL,
  message text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE public.dungeon_story ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read story" ON public.dungeon_story;
CREATE POLICY "Anyone can read story" ON public.dungeon_story FOR SELECT USING (true);

-- 6. user_avatars MP
ALTER TABLE public.user_avatars
  ADD COLUMN IF NOT EXISTS current_mp int NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS max_mp int NOT NULL DEFAULT 45;

-- 7. dungeon_monsters monster_skills
ALTER TABLE public.dungeon_monsters
  ADD COLUMN IF NOT EXISTS monster_skills jsonb DEFAULT '[]'::jsonb;

-- 8. Skills
INSERT INTO public.player_skills (skill_key, skill_name, skill_type, mp_cost, power, heal_amount, buff_type, buff_multiplier, buff_turns, description, required_level, icon_name) VALUES
('heat_spark', 'ヒートスパーク', 'attack', 3, 0.8, NULL, NULL, 1, 0, '星の火花を飛ばす初級呪文', 1, 'Flame'),
('petit_heal', 'プチヒール', 'heal', 3, 0, 30, NULL, 1, 0, '小さな癒しの光', 3, 'Heart'),
('light_blade', 'ライトブレード', 'attack', 5, 1.2, NULL, NULL, 1, 0, '光の刃で斬りつける', 5, 'Zap'),
('iron_guard', 'アイアンガード', 'buff', 4, 0, NULL, 'player_def', 1.5, 3, '鉄壁の守りを得る', 7, 'Shield'),
('weak_point', 'ウィークポイント', 'debuff', 4, 0, NULL, 'enemy_def', 0.5, 3, '敵の弱点を見抜く', 9, 'Target'),
('thunder_ray', 'サンダーレイ', 'attack', 8, 1.5, NULL, NULL, 1, 0, '雷光を落とす中級呪文', 10, 'CloudLightning'),
('middle_heal', 'ミドルヒール', 'heal', 8, 0, 80, NULL, 1, 0, '中程度の癒しの光', 12, 'HeartPulse'),
('power_charge', 'パワーチャージ', 'buff', 6, 0, NULL, 'player_atk', 2.0, 3, '力を溜めて攻撃力を上げる', 15, 'Swords'),
('nova_burst', 'ノヴァバースト', 'attack', 12, 1.8, NULL, NULL, 1, 0, '星の爆発で大ダメージ', 20, 'Bomb'),
('full_heal', 'フルヒール', 'heal', 15, 0, 9999, NULL, 1, 0, '完全なる癒しの光', 25, 'HeartHandshake'),
('luminas_ray', 'ルミナスレイ', 'attack', 20, 2.5, NULL, NULL, 1, 0, '王国最強の光線呪文', 30, 'Sparkles')
ON CONFLICT (skill_key) DO NOTHING;

-- 9. Items
INSERT INTO public.battle_items (item_key, item_name, effect_type, effect_amount, description, shop_price, icon_name) VALUES
('healing_herb', 'いやしの草', 'heal_hp', 30, 'HPを30回復する薬草', 10, 'Leaf'),
('star_water', '星のしずく', 'heal_mp', 20, 'MPを20回復する聖水', 20, 'Droplet'),
('revival_leaf', '蘇りの葉', 'revive', 50, '戦闘不能からHP半分で復活する伝説の葉', NULL, 'TreeDeciduous'),
('antidote_herb', '浄化の草', 'cure_poison', 0, '毒を治す薬草', 8, 'Pill')
ON CONFLICT (item_key) DO NOTHING;

-- 10. Starter functions
CREATE OR REPLACE FUNCTION public.ensure_starter_companion(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_companions (user_id, companion_key, companion_name, element, base_atk, base_def, base_hp, is_active, icon_name)
  VALUES (p_user_id, 'baby_slime', 'ベビースライム', 'water', 5, 3, 30, true, 'Droplet')
  ON CONFLICT (user_id, companion_key) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_starter_items(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_battle_items (user_id, item_key, quantity)
  VALUES (p_user_id, 'healing_herb', 3)
  ON CONFLICT (user_id, item_key) DO NOTHING;
END; $$;

-- 11. Story text
INSERT INTO public.dungeon_story (stage_key, timing, speaker, message, sort_order) VALUES
('dark_cave', 'intro', NULL, 'かつての王都の地下水路。今やモンスターの巣窟と化している。', 1),
('dark_cave', 'intro', NULL, '最初の星石「大地の星石」がこの奥に眠っているはずだ...', 2),
('dark_cave', 'boss_intro', NULL, '洞窟の最深部に巨大な影が立ちはだかった！', 1),
('dark_cave', 'boss_intro', 'ガルドス', '…守ラナケレバ…王国ヲ…守ラナケレバ…', 2),
('dark_cave', 'boss_defeat', 'ガルドス', '…すまなかった。あの夜、守れなかった。星石を…頼む…', 1),
('dark_cave', 'boss_defeat', NULL, '第1の星石「大地の星石」を手に入れた！', 2),
('dark_cave', 'boss_defeat', NULL, '復興率が上がった！ルミナス王国に希望の光が差し込む。', 3),
('ancient_ruins', 'intro', NULL, 'ルミナス王国初代国王イシュタル1世が眠る古代遺跡。', 1),
('ancient_ruins', 'intro', NULL, '遺跡の奥には、王が残した試練が待ち受けているという。', 2),
('ancient_ruins', 'boss_intro', 'イシュタル1世', '我が末裔よ、お前にその資格があるか確かめてやろう。', 1),
('ancient_ruins', 'boss_defeat', 'イシュタル1世', 'よくぞ勝った。お前には確かに星の血が流れている。', 1),
('ancient_ruins', 'boss_defeat', 'イシュタル1世', 'だが気をつけよ。エクリプスの王は...かつて我らの...', 2),
('ancient_ruins', 'boss_defeat', NULL, '言葉は途中で消え、謎だけが残った。', 3),
('ancient_ruins', 'boss_defeat', NULL, '第2の星石「英知の星石」を手に入れた！', 4),
('poison_swamp', 'intro', NULL, '猛毒に汚染された沼地。かつての宮廷魔術師が闇に寝返り汚染した場所だ。', 1),
('poison_swamp', 'intro', NULL, 'コンパニオンが毒の瘴気に苦しんでいる...急いで星石を見つけなければ！', 2),
('poison_swamp', 'boss_intro', NULL, '沼の底から三つの首が持ち上がった！', 1),
('poison_swamp', 'boss_intro', 'ヴェノーラ（左首）', 'お前の過去が見えるぞ...孤独な子供だった。', 2),
('poison_swamp', 'boss_intro', 'ヴェノーラ（中央首）', '今のお前では、我を倒せぬ。', 3),
('poison_swamp', 'boss_intro', 'ヴェノーラ（右首）', 'お前の未来は...闇だ。', 4),
('poison_swamp', 'boss_defeat', NULL, 'ヴェノーラが倒れると、沼の毒が浄化されていく。', 1),
('poison_swamp', 'boss_defeat', NULL, 'コンパニオンの体から毒が消えた！元気を取り戻した！', 2),
('poison_swamp', 'boss_defeat', NULL, '第3の星石「生命の星石」を手に入れた！', 3),
('fire_volcano', 'intro', NULL, 'かつてルミナス王国と同盟を結んでいた炎の民の故郷。', 1),
('fire_volcano', 'intro', NULL, '族長を失い、よそ者を激しく拒絶する生き残りたち。信頼を取り戻せるか？', 2),
('fire_volcano', 'boss_intro', 'カイ', 'お前がルミナスの末裔だと？笑わせるな。', 1),
('fire_volcano', 'boss_intro', NULL, '封印から解き放たれた古代の炎神が立ちはだかる！', 2),
('fire_volcano', 'boss_intro', '炎帝アグニ', '矮小な者よ。この炎は全てを灰にする。', 3),
('fire_volcano', 'boss_defeat', 'カイ', 'お前は...親父を殺した奴らと戦っているんだな。', 1),
('fire_volcano', 'boss_defeat', 'カイ', 'なら、俺たちも一緒に戦う。ルミナスとイグニスの同盟を復活させよう。', 2),
('fire_volcano', 'boss_defeat', NULL, '第4の星石「炎の星石」を手に入れた！', 3),
('sky_tower', 'intro', NULL, '天空に浮かぶ塔。ルミナス王国が星と交信するために建てた聖地。', 1),
('sky_tower', 'intro', NULL, '塔を登るにつれ、エクリプスの正体が明らかになっていく...', 2),
('sky_tower', 'intro', NULL, 'エクリプスの王は、かつてルミナスの王子だった。光に選ばれなかった兄が、闇に堕ちたのだ。', 3),
('sky_tower', 'boss_intro', NULL, '塔の頂上で、巨大な竜が目を覚ました！', 1),
('sky_tower', 'boss_intro', 'セレスティア', '我はかつて光の王と共にあった。光と闇は表裏一体。', 2),
('sky_tower', 'boss_intro', 'セレスティア', 'お前がこの先へ進むなら、闇をも受け入れる覚悟はあるか？', 3),
('sky_tower', 'boss_defeat', 'セレスティア', 'よいだろう。お前の覚悟、確かに見届けた。', 1),
('sky_tower', 'boss_defeat', 'セレスティア', '我はお前と共に行こう。最後の戦いへ。', 2),
('sky_tower', 'boss_defeat', NULL, '第5の星石「天空の星石」を手に入れた！', 3),
('sky_tower', 'boss_defeat', NULL, '全ての星石が揃った時、最後の扉が開く...', 4)
ON CONFLICT DO NOTHING;

-- 12. Boss skills
UPDATE public.dungeon_monsters SET monster_skills = '[
  {"action":"attack","weight":50,"message":"が巨大な拳を振り下ろした！"},
  {"action":"skill","skill_name":"大地の怒り","power":1.5,"weight":30,"message":"が地面を揺らした！大地の怒り！"},
  {"action":"defend","weight":20,"message":"は身を固くした！"}
]'::jsonb WHERE monster_key = 'cave_troll';

UPDATE public.dungeon_monsters SET monster_skills = '[
  {"action":"attack","weight":40,"message":"が王笏で打ちつけた！"},
  {"action":"skill","skill_name":"王の裁き","power":1.8,"weight":25,"message":"が王の裁きを下した！"},
  {"action":"skill","skill_name":"王の祈り","power":0,"heal":50,"weight":15,"message":"が祈りを捧げた！傷が癒えていく！"},
  {"action":"defend","weight":20,"message":"は威厳を保ち構えている！"}
]'::jsonb WHERE monster_key = 'pharaoh';

UPDATE public.dungeon_monsters SET monster_skills = '[
  {"action":"attack","weight":35,"message":"の左首が噛みついた！"},
  {"action":"skill","skill_name":"猛毒の息","power":1.2,"weight":25,"message":"が猛毒の息を吐いた！"},
  {"action":"skill","skill_name":"三連撃","power":0.5,"hits":3,"weight":20,"message":"の三つの首が同時に襲いかかった！"},
  {"action":"defend","weight":20,"message":"は首をもたげて様子を窺っている！"}
]'::jsonb WHERE monster_key = 'hydra';

UPDATE public.dungeon_monsters SET monster_skills = '[
  {"action":"attack","weight":30,"message":"が灼熱の拳を叩きつけた！"},
  {"action":"skill","skill_name":"煉獄の炎","power":2.0,"weight":25,"message":"が煉獄の炎を解き放った！"},
  {"action":"skill","skill_name":"火炎旋風","power":1.5,"weight":25,"message":"が火炎旋風を巻き起こした！"},
  {"action":"defend","weight":20,"message":"は炎を纏い力を溜めている！"}
]'::jsonb WHERE monster_key = 'ifrit';

UPDATE public.dungeon_monsters SET monster_skills = '[
  {"action":"attack","weight":25,"message":"が鋭い爪で切り裂いた！"},
  {"action":"skill","skill_name":"浄化の波動","power":0,"dispel":true,"weight":15,"message":"が浄化の波動を放った！強化が消し去られた！"},
  {"action":"skill","skill_name":"天空の裁き","power":2.2,"weight":25,"message":"が天空の裁きを下した！"},
  {"action":"skill","skill_name":"星の癒し","power":0,"heal":100,"weight":15,"message":"が星の力で傷を癒した！"},
  {"action":"defend","weight":20,"message":"は翼を広げて守りを固めた！"}
]'::jsonb WHERE monster_key = 'sky_dragon';

-- 13. complete_dungeon_run: keep existing logic + add MP recovery
CREATE OR REPLACE FUNCTION public.complete_dungeon_run(
  p_run_id uuid,
  p_floors_cleared integer,
  p_total_exp integer,
  p_total_coins integer,
  p_result text,
  p_dropped_materials jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run record;
  v_mat jsonb;
  v_lv int;
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

  -- MP full recovery
  SELECT COALESCE(level,1) INTO v_lv FROM public.user_avatars WHERE user_id = v_run.user_id;
  UPDATE public.user_avatars
    SET current_mp = 20 + (COALESCE(v_lv,1) * 5),
        max_mp = 20 + (COALESCE(v_lv,1) * 5)
  WHERE user_id = v_run.user_id;

  RETURN jsonb_build_object(
    'success', true,
    'floors_cleared', p_floors_cleared,
    'total_exp', p_total_exp,
    'total_coins', p_total_coins,
    'result', p_result,
    'materials', p_dropped_materials
  );
END; $$;
