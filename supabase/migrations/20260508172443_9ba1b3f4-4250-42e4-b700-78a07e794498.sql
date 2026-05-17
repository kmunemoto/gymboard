
-- 1. Master table
CREATE TABLE public.avatar_frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frame_key text UNIQUE NOT NULL,
  frame_name text NOT NULL,
  rarity text NOT NULL CHECK (rarity IN ('epic','legendary')),
  image_path text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.avatar_frames ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view frames" ON public.avatar_frames FOR SELECT USING (true);

-- 2. Inventory
CREATE TABLE public.user_frame_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  frame_key text NOT NULL REFERENCES public.avatar_frames(frame_key) ON DELETE CASCADE,
  obtained_via text NOT NULL DEFAULT 'gacha',
  obtained_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, frame_key)
);
CREATE INDEX idx_user_frame_inventory_user ON public.user_frame_inventory(user_id);
ALTER TABLE public.user_frame_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own frames" ON public.user_frame_inventory FOR SELECT
  USING (auth.uid() = user_id OR has_role(auth.uid(),'trainer'::app_role));

-- 3. Seed
INSERT INTO public.avatar_frames (frame_key, frame_name, rarity, image_path, sort_order) VALUES
  ('silver',  'シルバーフレーム',     'epic',      '/shop/frames/silver.png',  1),
  ('gold',    'ゴールドフレーム',     'epic',      '/shop/frames/gold.png',    2),
  ('sakura',  '桜フレーム',           'epic',      '/shop/frames/sakura.png',  3),
  ('ocean',   'オーシャンフレーム',   'epic',      '/shop/frames/ocean.png',   4),
  ('flame',   'フレイムフレーム',     'epic',      '/shop/frames/flame.png',   5),
  ('ice',     'アイスフレーム',       'epic',      '/shop/frames/ice.png',     6),
  ('star',    'スターフレーム',       'legendary', '/shop/frames/star.png',    7),
  ('royal',   'ロイヤルフレーム',     'legendary', '/shop/frames/royal.png',   8),
  ('neon',    'ネオンフレーム',       'legendary', '/shop/frames/neon.png',    9),
  ('diamond', 'ダイヤモンドフレーム', 'legendary', '/shop/frames/diamond.png', 10);

-- 4. equip_frame RPC
CREATE OR REPLACE FUNCTION public.equip_frame(p_frame_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owns boolean;
  v_special boolean;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
  IF p_frame_key IS NULL THEN
    UPDATE public.user_avatars SET equipped_frame = NULL, updated_at = now() WHERE user_id = v_user;
    RETURN jsonb_build_object('equipped', NULL);
  END IF;
  -- Allow legacy CSS frames (rainbow_legend / quest_kingdom_hero) if avatar already has them awarded
  v_special := p_frame_key IN ('rainbow_legend','quest_kingdom_hero');
  IF v_special THEN
    v_owns := EXISTS(SELECT 1 FROM public.user_avatars WHERE user_id = v_user AND equipped_frame = p_frame_key)
           OR EXISTS(SELECT 1 FROM public.user_quest_progress WHERE user_id = v_user AND p_frame_key = 'quest_kingdom_hero')
           OR EXISTS(SELECT 1 FROM public.avatar_collection_rewards WHERE user_id = v_user AND milestone = 41 AND p_frame_key = 'rainbow_legend');
  ELSE
    v_owns := EXISTS(SELECT 1 FROM public.user_frame_inventory WHERE user_id = v_user AND frame_key = p_frame_key);
  END IF;
  IF NOT v_owns THEN RAISE EXCEPTION 'フレームを所持していません'; END IF;
  UPDATE public.user_avatars SET equipped_frame = p_frame_key, updated_at = now() WHERE user_id = v_user;
  RETURN jsonb_build_object('equipped', p_frame_key);
END $$;

-- 5. Update spin_gacha to maybe award a frame on epic/legendary
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

  -- Frame chance: 30% on epic/legendary
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
        UPDATE public.user_avatars
          SET coins = coins + v_frame_dup_coins, updated_at = now()
          WHERE user_id = _user_id;
        INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_key, reward_amount, rarity, ticket_id)
          VALUES (_user_id, _result_date, 'frame_dup', v_frame.frame_key, v_frame_dup_coins, v_rarity, v_ticket.id);
      ELSE
        INSERT INTO public.user_frame_inventory (user_id, frame_key, obtained_via)
          VALUES (_user_id, v_frame.frame_key, 'gacha');
        INSERT INTO public.gacha_results (user_id, result_date, reward_type, reward_key, reward_amount, rarity, ticket_id)
          VALUES (_user_id, _result_date, 'frame', v_frame.frame_key, 0, v_rarity, v_ticket.id);
      END IF;

      SELECT COUNT(*) INTO v_remaining FROM public.user_gacha_tickets
        WHERE user_id = _user_id AND used = false;

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

  -- Original coin/exp pool
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
    UPDATE public.user_avatars SET coins = coins + (v_reward->>'amount')::int, updated_at = now()
      WHERE user_id = _user_id;
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

  SELECT COUNT(*) INTO v_remaining FROM public.user_gacha_tickets
    WHERE user_id = _user_id AND used = false;

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
