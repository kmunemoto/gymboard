
-- 1. Columns on user_avatars
ALTER TABLE public.user_avatars
  ADD COLUMN IF NOT EXISTS featured_badges text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS equipped_frame text;

-- 2. Collection rewards table
CREATE TABLE IF NOT EXISTS public.avatar_collection_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  milestone integer NOT NULL,
  coins_awarded integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, milestone)
);

ALTER TABLE public.avatar_collection_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own collection rewards" ON public.avatar_collection_rewards;
CREATE POLICY "Users view own collection rewards"
ON public.avatar_collection_rewards FOR SELECT TO authenticated
USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- 3. Set featured badges (validates ownership, max 3)
CREATE OR REPLACE FUNCTION public.set_featured_badges(p_badges text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_clean text[];
  v_invalid int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
  v_clean := COALESCE(p_badges, ARRAY[]::text[]);
  IF array_length(v_clean, 1) > 3 THEN
    RAISE EXCEPTION 'お気に入りバッジは最大3つまでです';
  END IF;
  IF array_length(v_clean, 1) IS NOT NULL THEN
    SELECT count(*) INTO v_invalid
    FROM unnest(v_clean) k
    WHERE NOT EXISTS (
      SELECT 1 FROM public.avatar_achievements
      WHERE user_id = v_user_id AND achievement_key = k
    );
    IF v_invalid > 0 THEN
      RAISE EXCEPTION '取得していないバッジが含まれています';
    END IF;
  END IF;
  INSERT INTO public.user_avatars (user_id, featured_badges)
  VALUES (v_user_id, v_clean)
  ON CONFLICT (user_id) DO UPDATE SET featured_badges = v_clean, updated_at = now();
END;
$$;

-- 4. Milestone evaluation
CREATE OR REPLACE FUNCTION public.check_collection_milestones(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int;
  v_milestones jsonb := '[]'::jsonb;
  v_milestone_def record;
BEGIN
  IF _user_id IS NULL THEN RETURN jsonb_build_object('granted','[]'::jsonb); END IF;

  SELECT COUNT(*) INTO v_count FROM public.avatar_achievements WHERE user_id = _user_id;

  FOR v_milestone_def IN
    SELECT * FROM (VALUES
      (10, 50, 'collector', 'コレクター'),
      (20, 100, 'badge_master', 'バッジマスター'),
      (30, 200, 'complete_road', 'コンプリートへの道'),
      (41, 500, 'legend_collector', 'レジェンドコレクター')
    ) AS m(milestone, coins, title_key, title_name)
  LOOP
    IF v_count >= v_milestone_def.milestone THEN
      -- Try to insert reward record (idempotent via UNIQUE)
      BEGIN
        INSERT INTO public.avatar_collection_rewards (user_id, milestone, coins_awarded)
        VALUES (_user_id, v_milestone_def.milestone, v_milestone_def.coins);

        -- Grant coins
        UPDATE public.user_avatars
        SET coins = COALESCE(coins,0) + v_milestone_def.coins, updated_at = now()
        WHERE user_id = _user_id;

        -- Grant title
        INSERT INTO public.user_titles (user_id, title_key)
        VALUES (_user_id, v_milestone_def.title_key)
        ON CONFLICT (user_id, title_key) DO NOTHING;

        -- Special: full collection grants rainbow frame (auto-equip if no frame yet)
        IF v_milestone_def.milestone = 41 THEN
          UPDATE public.user_avatars
          SET equipped_frame = COALESCE(equipped_frame, 'rainbow_legend'), updated_at = now()
          WHERE user_id = _user_id;
        END IF;

        v_milestones := v_milestones || jsonb_build_object(
          'milestone', v_milestone_def.milestone,
          'coins', v_milestone_def.coins,
          'title_key', v_milestone_def.title_key,
          'title_name', v_milestone_def.title_name,
          'frame', CASE WHEN v_milestone_def.milestone = 41 THEN 'rainbow_legend' ELSE NULL END
        );
      EXCEPTION WHEN unique_violation THEN
        -- Already granted
        NULL;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('granted', v_milestones, 'badge_count', v_count);
END;
$$;

-- 5. Update spin_gacha to factor in epic badge ownership
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
BEGIN
  IF auth.uid() IS DISTINCT FROM _user_id AND NOT has_role(auth.uid(), 'trainer'::app_role) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_ticket FROM public.user_gacha_tickets
  WHERE user_id = _user_id AND used = false
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('no_ticket', true, 'remaining', 0);
  END IF;

  SELECT COALESCE(level, 1) INTO v_user_level FROM public.user_avatars WHERE user_id = _user_id;
  v_user_level := COALESCE(v_user_level, 1);

  IF v_user_level <= 5 THEN
    v_pc := 60; v_pr := 85; v_pe := 97;
  ELSIF v_user_level <= 15 THEN
    v_pc := 57; v_pr := 82; v_pe := 96;
  ELSIF v_user_level <= 30 THEN
    v_pc := 53; v_pr := 78; v_pe := 95;
  ELSIF v_user_level <= 50 THEN
    v_pc := 49; v_pr := 74; v_pe := 94;
  ELSE
    v_pc := 42; v_pr := 67; v_pe := 92;
  END IF;

  -- Epic badge bonus: count epic badges owned
  SELECT COUNT(*) INTO v_epic_count
  FROM public.avatar_achievements
  WHERE user_id = _user_id
    AND achievement_key IN (
      'habit_formed','perfect_week','hundred_sessions','half_year','ten_ton_club',
      'gacha_legend','record_breaker','two_hundred_sessions','one_year','combo_king',
      'raid_mvp','month_200k','level_50'
    );

  IF v_epic_count >= 10 THEN
    v_legendary_bonus := 2;
  ELSIF v_epic_count >= 5 THEN
    v_legendary_bonus := 1;
  END IF;

  -- Apply bonus: shift v_pc and v_pr down by bonus, v_pe down by bonus
  -- Effect: legendary tier (100 - v_pe) increases by v_legendary_bonus, common decreases.
  v_pc := GREATEST(0, v_pc - v_legendary_bonus);
  v_pr := GREATEST(v_pc, v_pr - v_legendary_bonus);
  v_pe := GREATEST(v_pr, v_pe - v_legendary_bonus);

  v_roll := floor(random() * 100)::int;
  IF v_roll < v_pc THEN v_rarity := 'common';
  ELSIF v_roll < v_pr THEN v_rarity := 'rare';
  ELSIF v_roll < v_pe THEN v_rarity := 'epic';
  ELSE v_rarity := 'legendary';
  END IF;

  v_pool := CASE v_rarity
    WHEN 'common' THEN '[
      {"type":"coins","amount":5},{"type":"coins","amount":10},
      {"type":"exp","amount":20},{"type":"exp","amount":30}]'::jsonb
    WHEN 'rare' THEN '[
      {"type":"coins","amount":25},{"type":"coins","amount":30},
      {"type":"exp","amount":50},{"type":"exp","amount":75}]'::jsonb
    WHEN 'epic' THEN '[
      {"type":"coins","amount":50},{"type":"coins","amount":75},
      {"type":"exp","amount":100}]'::jsonb
    ELSE '[
      {"type":"coins","amount":150},{"type":"coins","amount":200},
      {"type":"exp","amount":200}]'::jsonb
  END;

  v_idx := floor(random() * jsonb_array_length(v_pool))::int;
  v_reward := v_pool -> v_idx;

  UPDATE public.user_gacha_tickets
  SET used = true, used_at = now()
  WHERE id = v_ticket.id;

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
    SET total_exp = v_total_exp,
        level = v_new_level,
        coins = coins + v_added_coins,
        updated_at = now()
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

-- 6. Add unique on user_id for upsert support (safety)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_avatars_user_id_unique') THEN
    BEGIN
      ALTER TABLE public.user_avatars ADD CONSTRAINT user_avatars_user_id_unique UNIQUE (user_id);
    EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
