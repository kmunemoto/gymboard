
CREATE TABLE IF NOT EXISTS public.companion_defs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  companion_key text UNIQUE NOT NULL,
  companion_name text NOT NULL,
  element text NOT NULL,
  evolution_stage int NOT NULL DEFAULT 1,
  evolves_from text DEFAULT NULL,
  evolve_level int DEFAULT NULL,
  base_atk int NOT NULL,
  base_def int NOT NULL,
  base_hp int NOT NULL,
  skill_name text NOT NULL,
  skill_description text NOT NULL,
  skill_power numeric NOT NULL DEFAULT 0.8,
  skill_type text NOT NULL DEFAULT 'attack',
  rarity text NOT NULL DEFAULT 'rare',
  image_path text NOT NULL
);
ALTER TABLE public.companion_defs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read companion_defs" ON public.companion_defs;
CREATE POLICY "Anyone can read companion_defs" ON public.companion_defs FOR SELECT USING (true);

INSERT INTO public.companion_defs (companion_key, companion_name, element, evolution_stage, evolves_from, evolve_level, base_atk, base_def, base_hp, skill_name, skill_description, skill_power, skill_type, rarity, image_path) VALUES
('baby_slime',     'ベビースライム',   'water', 1, NULL,             NULL, 5,  3,  30,  '体当たり',     '体でぶつかる',                  0.8, 'attack',            'common',    'companions/baby_slime.png'),
('slime_knight',   'スライムナイト',   'water', 2, 'baby_slime',     10,   12, 8,  60,  '水流撃',       '水の力で攻撃',                  1.3, 'attack',            'rare',      'companions/slime_knight.png'),
('king_slime',     'キングスライム',   'water', 3, 'slime_knight',   30,   22, 15, 100, '王の威圧',     '敵のATKを20%下げる(3ターン)',   0,   'debuff_atk',        'legendary', 'companions/king_slime.png'),
('fox_kit',        '子キツネ',         'fire',  1, NULL,             NULL, 7,  2,  25,  '火花噛み',     '炎をまとった噛みつき',          0.9, 'attack',            'epic',      'companions/fox_kit.png'),
('spirit_fox',     '妖狐',             'fire',  2, 'fox_kit',        10,   18, 6,  50,  '狐火',         '狐火で焼き尽くす',              1.5, 'attack',            'epic',      'companions/spirit_fox.png'),
('nine_tails',     '九尾',             'fire',  3, 'spirit_fox',     30,   35, 12, 85,  '九尾の炎',     '敵DEF無視の炎攻撃',             2.0, 'attack_ignore_def', 'legendary', 'companions/nine_tails.png'),
('chick',          'ヒヨコ',           'wind',  1, NULL,             NULL, 4,  3,  28,  'つつき',       'くちばしで突く',                0.7, 'attack',            'epic',      'companions/chick.png'),
('cockatrice',     'コカトリス',       'wind',  2, 'chick',          10,   14, 7,  55,  '風の羽',       '味方の会心率+15%(3ターン)',     0,   'buff_crit',         'epic',      'companions/cockatrice.png'),
('phoenix',        'フェニックス',     'wind',  3, 'cockatrice',     30,   25, 14, 90,  '不死鳥の翼',   '味方HP全回復+1回復活付与',      0,   'full_heal_revive',  'legendary', 'companions/phoenix.png'),
('bear_cub',       '子グマ',           'earth', 1, NULL,             NULL, 5,  5,  35,  '引っかき',     '爪で引っかく',                  0.8, 'attack',            'epic',      'companions/bear_cub.png'),
('iron_bear',      'アイアンベア',     'earth', 2, 'bear_cub',       10,   10, 14, 80,  '鉄の守り',     '味方DEF+30%(3ターン)',          0,   'buff_def',          'epic',      'companions/iron_bear.png'),
('behemoth',       'ベヒーモス',       'earth', 3, 'iron_bear',      30,   20, 25, 130, '大地の怒り',   '大ダメージ+自分HP20%回復',      1.8, 'attack_heal',       'legendary', 'companions/behemoth.png'),
('light_spirit',   '光の精',           'light', 1, NULL,             NULL, 3,  3,  25,  '光の粒',       '味方HP15回復',                  15,  'heal',              'epic',      'companions/light_spirit.png'),
('angel',          'エンジェル',       'light', 2, 'light_spirit',   10,   8,  8,  50,  '聖なる光',     '味方HP40回復+毒治療',           40,  'heal_cure',         'epic',      'companions/angel.png'),
('seraphim',       'セラフィム',       'light', 3, 'angel',          30,   15, 18, 80,  '天使の祈り',   '味方HP全回復+全バフ付与',       0,   'full_heal_buff',    'legendary', 'companions/seraphim.png'),
('shadow_cat',     '影ネコ',           'dark',  1, NULL,             NULL, 8,  2,  22,  '闇爪',         '影の爪で切り裂く',              0.9, 'attack',            'epic',      'companions/shadow_cat.png'),
('shadow_panther', 'シャドウパンサー', 'dark',  2, 'shadow_cat',     10,   20, 5,  45,  '影縫い',       '敵を1ターン行動不能にする',     0,   'stun',              'epic',      'companions/shadow_panther.png'),
('bahamut',        'バハムート',       'dark',  3, 'shadow_panther', 30,   40, 10, 75,  '暗黒の息吹',   '最強の闇ブレス攻撃',            2.5, 'attack',            'legendary', 'companions/bahamut.png')
ON CONFLICT (companion_key) DO NOTHING;

ALTER TABLE public.user_companions
  ADD COLUMN IF NOT EXISTS fed_today boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_fed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS feed_streak int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_path text DEFAULT NULL;

UPDATE public.user_companions uc
   SET image_path = cd.image_path
  FROM public.companion_defs cd
 WHERE uc.companion_key = cd.companion_key AND uc.image_path IS NULL;

ALTER TABLE public.equipment_items DROP CONSTRAINT IF EXISTS equipment_items_item_type_check;
ALTER TABLE public.equipment_items
  ADD CONSTRAINT equipment_items_item_type_check
  CHECK (item_type IN ('weapon','shield','amulet','top','bottom','accessory','companion_egg'));

CREATE OR REPLACE FUNCTION public.ensure_starter_companion(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_companions (user_id, companion_key, companion_name, element, base_atk, base_def, base_hp, is_active, icon_name, image_path)
  VALUES (p_user_id, 'baby_slime', 'ベビースライム', 'water', 5, 3, 30, true, 'Droplet', 'companions/baby_slime.png')
  ON CONFLICT (user_id, companion_key) DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.feed_companion(p_user_id uuid, p_companion_key text, p_premium boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_comp record;
  v_evo_def record;
  v_exp_gain int;
  v_cost int := 0;
  v_coins int;
  v_new_exp int;
  v_new_level int;
  v_evolved boolean := false;
  v_evolution_key text := NULL;
  v_new_streak int;
BEGIN
  UPDATE public.user_companions
     SET fed_today = false
   WHERE user_id = p_user_id
     AND fed_today = true
     AND (last_fed_at IS NULL OR last_fed_at::date < CURRENT_DATE);

  SELECT * INTO v_comp FROM public.user_companions
   WHERE user_id = p_user_id AND companion_key = p_companion_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'コンパニオンが見つかりません'); END IF;

  IF p_premium THEN
    v_exp_gain := 150;
    v_cost := 50;
    SELECT coins INTO v_coins FROM public.user_avatars WHERE user_id = p_user_id;
    IF v_coins IS NULL OR v_coins < v_cost THEN RETURN jsonb_build_object('error', 'コインが足りません'); END IF;
    UPDATE public.user_avatars SET coins = coins - v_cost WHERE user_id = p_user_id;
  ELSE
    IF v_comp.fed_today THEN RETURN jsonb_build_object('error', '今日はもうエサをあげました'); END IF;
    v_exp_gain := 50;
  END IF;

  IF v_comp.feed_streak >= 3 THEN
    v_exp_gain := FLOOR(v_exp_gain * 1.5);
  END IF;

  v_new_exp := v_comp.exp + v_exp_gain;
  v_new_level := v_comp.level;
  WHILE v_new_exp >= v_new_level * 100 LOOP
    v_new_exp := v_new_exp - v_new_level * 100;
    v_new_level := v_new_level + 1;
  END LOOP;

  IF v_comp.last_fed_at IS NOT NULL AND v_comp.last_fed_at::date = CURRENT_DATE - 1 THEN
    v_new_streak := v_comp.feed_streak + 1;
  ELSIF v_comp.last_fed_at IS NOT NULL AND v_comp.last_fed_at::date = CURRENT_DATE THEN
    v_new_streak := v_comp.feed_streak;
  ELSE
    v_new_streak := 1;
  END IF;

  SELECT * INTO v_evo_def
    FROM public.companion_defs
   WHERE evolves_from = p_companion_key AND evolve_level <= v_new_level
   LIMIT 1;

  IF FOUND THEN
    v_evolved := true;
    v_evolution_key := v_evo_def.companion_key;
    UPDATE public.user_companions SET
      companion_key = v_evo_def.companion_key,
      companion_name = v_evo_def.companion_name,
      element = v_evo_def.element,
      level = v_new_level,
      exp = v_new_exp,
      base_atk = v_evo_def.base_atk,
      base_def = v_evo_def.base_def,
      base_hp = v_evo_def.base_hp,
      image_path = v_evo_def.image_path,
      fed_today = CASE WHEN NOT p_premium THEN true ELSE v_comp.fed_today END,
      last_fed_at = now(),
      feed_streak = v_new_streak
    WHERE user_id = p_user_id AND companion_key = p_companion_key;
  ELSE
    UPDATE public.user_companions SET
      level = v_new_level,
      exp = v_new_exp,
      fed_today = CASE WHEN NOT p_premium THEN true ELSE v_comp.fed_today END,
      last_fed_at = now(),
      feed_streak = v_new_streak
    WHERE user_id = p_user_id AND companion_key = p_companion_key;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'exp_gain', v_exp_gain,
    'new_level', v_new_level,
    'new_exp', v_new_exp,
    'evolved', v_evolved,
    'evolution_key', v_evolution_key,
    'cost', v_cost
  );
END; $$;

INSERT INTO public.equipment_items (item_key, item_name, item_type, rarity, atk_bonus, def_bonus, hp_bonus, source, icon_name, image_path) VALUES
('egg_fox',    '炎のたまご',   'companion_egg', 'epic', 0, 0, 0, 'ガチャ', 'Egg', 'companions/fox_kit.png'),
('egg_chick',  '風のたまご',   'companion_egg', 'epic', 0, 0, 0, 'ガチャ', 'Egg', 'companions/chick.png'),
('egg_bear',   '大地のたまご', 'companion_egg', 'epic', 0, 0, 0, 'ガチャ', 'Egg', 'companions/bear_cub.png'),
('egg_light',  '光のたまご',   'companion_egg', 'epic', 0, 0, 0, 'ガチャ', 'Egg', 'companions/light_spirit.png'),
('egg_shadow', '闇のたまご',   'companion_egg', 'epic', 0, 0, 0, 'ガチャ', 'Egg', 'companions/shadow_cat.png')
ON CONFLICT (item_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.hatch_companion_egg(p_user_id uuid, p_egg_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_egg record;
  v_def record;
  v_already boolean;
BEGIN
  SELECT * INTO v_egg FROM public.equipment_items
   WHERE item_key = p_egg_key AND item_type = 'companion_egg';
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '卵が見つかりません'); END IF;

  SELECT * INTO v_def FROM public.companion_defs
   WHERE evolution_stage = 1 AND image_path = v_egg.image_path
   LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', '対応するコンパニオンがありません'); END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_companions WHERE user_id = p_user_id AND companion_key = v_def.companion_key
  ) INTO v_already;

  IF NOT v_already THEN
    INSERT INTO public.user_companions
      (user_id, companion_key, companion_name, element, base_atk, base_def, base_hp, is_active, icon_name, image_path)
    VALUES
      (p_user_id, v_def.companion_key, v_def.companion_name, v_def.element,
       v_def.base_atk, v_def.base_def, v_def.base_hp, false, 'Cat', v_def.image_path);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_owned', v_already,
    'companion_key', v_def.companion_key,
    'companion_name', v_def.companion_name,
    'image_path', v_def.image_path
  );
END; $$;

CREATE OR REPLACE FUNCTION public.set_active_companion(p_user_id uuid, p_companion_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.user_companions SET is_active = false
   WHERE user_id = p_user_id AND is_active = true;
  UPDATE public.user_companions SET is_active = true
   WHERE user_id = p_user_id AND companion_key = p_companion_key;
  RETURN jsonb_build_object('success', true);
END; $$;
