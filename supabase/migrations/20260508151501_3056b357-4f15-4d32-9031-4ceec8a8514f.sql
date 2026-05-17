
-- ============== Quest stages master ==============
CREATE TABLE public.quest_stages (
  id integer PRIMARY KEY,
  stage_number integer UNIQUE NOT NULL,
  name text NOT NULL,
  name_before text NOT NULL,
  description text NOT NULL,
  story_intro text NOT NULL,
  story_complete text NOT NULL,
  theme_gradient_from text NOT NULL,
  theme_gradient_to text NOT NULL,
  theme_dark_from text NOT NULL,
  theme_dark_to text NOT NULL,
  theme_icon text NOT NULL,
  reward_coins integer NOT NULL,
  reward_exp integer NOT NULL,
  reward_title text,
  reward_badge_key text,
  reward_frame boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.quest_stage_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id integer NOT NULL REFERENCES public.quest_stages(id) ON DELETE CASCADE,
  condition_type text NOT NULL,
  target_value numeric NOT NULL,
  display_label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE public.user_quest_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  current_stage integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_quest_stage_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stage_id integer NOT NULL REFERENCES public.quest_stages(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  rewards_claimed boolean NOT NULL DEFAULT true,
  UNIQUE(user_id, stage_id)
);

ALTER TABLE public.quest_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quest_stage_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_quest_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_quest_stage_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated views quest stages"
  ON public.quest_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Anyone authenticated views quest conditions"
  ON public.quest_stage_conditions FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users view own quest progress"
  ON public.user_quest_progress FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));
CREATE POLICY "Users insert own quest progress"
  ON public.user_quest_progress FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own quest progress"
  ON public.user_quest_progress FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Users view own quest completions"
  ON public.user_quest_stage_completions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- ============== Seed stages ==============
INSERT INTO public.quest_stages (id, stage_number, name, name_before, description, story_intro, story_complete, theme_gradient_from, theme_gradient_to, theme_dark_from, theme_dark_to, theme_icon, reward_coins, reward_exp, reward_title, reward_badge_key, reward_frame) VALUES
(1,1,'王城の門','崩れた城門','王国の入口に光を取り戻せ。','かつて栄華を誇ったルミナス王国。ある日、空を覆う闇が全てを飲み込んだ。崩れた城門の前に立つあなたに、最後の守護者が語りかける。「この国を救えるのは、あなただけです。」','城門に光が戻った。重い扉がゆっくりと開き、朝日が差し込む。王国復興の第一歩。だが門の向こうに広がるのは、枯れ果てた庭園だった。','#fbbf24','#f59e0b','#4a4a4a','#2a2a2a','DoorOpen',50,50,'liberator',NULL,false),
(2,2,'花咲く庭園','枯れた花園','女王が愛した庭園に色を取り戻せ。','女王が愛した庭園は見る影もない。枯れた木々の間を冷たい風が吹き抜ける。かつてここには王国一美しい花が咲いていたという。','一輪、また一輪と花が咲き始めた。庭園に色が戻っていく。風に乗って花の香りが港町まで届いた。だがその港は凍りついたまま...','#f9a8d4','#ec4899','#5a5a5a','#3a3a3a','Flower2',80,100,NULL,'quest_garden_bloom',false),
(3,3,'港町マリーナ','凍りついた港','凍てつく港を解き放て。','氷に閉ざされた港。船は動かず、波の音すら聞こえない。この港が動けば、王国に物資と希望が届く。','氷が溶け、波が岸壁を打つ音が帰ってきた。港に最初の船が入ってくる。船乗りたちが歓声を上げる。次は街の復興だ。','#67e8f9','#0891b2','#4a5568','#2d3748','Anchor',100,150,'harbor_guardian',NULL,false),
(4,4,'鍛冶屋通り','灰に沈む街','職人の街に炎を灯せ。','灰に埋もれた職人の街。鍛冶の炉は冷え切り、金槌の音は絶えて久しい。この街の職人たちの技術が、王国再建の鍵を握る。','炉に火が灯り、金槌の音が街に響き渡る。職人たちが戻ってきた。鍛え上げられた武具を手に、次は森の呪いを解きに行こう。','#fdba74','#ea580c','#57534e','#292524','Hammer',120,200,NULL,'quest_forge_master',false),
(5,5,'精霊の森','呪われた森','森の呪いを解き放て。','かつて精霊たちが暮らした美しい森は、呪いで闇に沈んでいる。森の奥から微かな光が助けを求めている。','呪いが解け、精霊たちが姿を現した。森全体が翡翠色の光で満たされる。精霊の長があなたに言った。「塔の呪いも、きっとあなたなら...」','#6ee7b7','#059669','#3f3f46','#1a1a2e','TreePine',150,250,'spirit_ally',NULL,false),
(6,6,'星見の塔','呪いの塔','天文台の塔を取り戻せ。','王国の天文台だった塔は、今は呪いの紫煙に覆われている。かつてここから見た星空は世界で最も美しいと言われた。','呪いが晴れた夜空に、満天の星が瞬いた。塔の頂上から見下ろすと、復興した街の灯りが星のように輝いている。王国は確実に蘇りつつある。','#c4b5fd','#7c3aed','#44403c','#1c1917','Star',200,300,NULL,'quest_stargazer',false),
(7,7,'天空の橋','嵐の断崖','嵐を抜けて道を切り開け。','王国の最後の関門。嵐に閉ざされた断崖の先に、大聖堂への道が続いている。暴風の中を進む覚悟はあるか。','嵐が止み、雲の切れ間から虹の橋が架かった。その先に闇に包まれた大聖堂が見える。全てはこの最後の戦いにかかっている。','#93c5fd','#2563eb','#475569','#1e293b','CloudSun',250,400,'sky_pioneer',NULL,false),
(8,8,'光の大聖堂','闇の大聖堂','王国に最後の光を取り戻せ。','王国の心臓部。ここに光を取り戻せば、全てが元に戻る。大聖堂の闇は深いが、これまでの旅で得た力があれば...','大聖堂に黄金の光が満ちた。闇は完全に消え去り、ルミナス王国は蘇った。街には笑顔が溢れ、花が咲き、波が歌う。あなたの名は「王国の英雄」として永遠に刻まれた。','#fde68a','#ffffff','#1f1f1f','#000000','Church',500,500,'kingdom_hero',NULL,true);

-- ============== Seed conditions ==============
INSERT INTO public.quest_stage_conditions (stage_id, condition_type, target_value, display_label, sort_order) VALUES
(1,'total_sessions',3,'来店3回',1),
(1,'total_volume',5000,'総挙上量5,000kg',2),
(1,'total_missions',1,'ミッション1回達成',3),
(2,'total_sessions',7,'来店7回',1),
(2,'personal_best_count',1,'自己ベスト1種目',2),
(2,'total_missions',5,'ミッション5回達成',3),
(3,'total_sessions',12,'来店12回',1),
(3,'total_volume',30000,'総挙上量30,000kg',2),
(3,'max_combo',3,'コンボ3達成',3),
(4,'personal_best_count',3,'自己ベスト3種目',1),
(4,'total_volume',60000,'総挙上量60,000kg',2),
(4,'total_missions',15,'ミッション15回達成',3),
(5,'total_sessions',25,'来店25回',1),
(5,'max_combo',5,'コンボ5達成',2),
(5,'rival_wins',1,'ライバルバトル1勝',3),
(6,'total_volume',120000,'総挙上量120,000kg',1),
(6,'personal_best_count',5,'自己ベスト5種目',2),
(6,'total_missions',30,'ミッション30回達成',3),
(7,'total_sessions',50,'来店50回',1),
(7,'max_combo',7,'コンボ7達成',2),
(7,'raid_participations',1,'レイドボス1回参加',3),
(8,'total_volume',200000,'総挙上量200,000kg',1),
(8,'personal_best_count',8,'自己ベスト8種目',2),
(8,'rival_wins',3,'ライバルバトル3勝',3);

-- ============== RPC: condition values for a single user ==============
CREATE OR REPLACE FUNCTION public._quest_condition_values(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_sessions int;
  v_total_volume numeric;
  v_total_missions int;
  v_pb_count int;
  v_max_combo int;
  v_rival_wins int;
  v_raid_parts int;
BEGIN
  SELECT COUNT(DISTINCT workout_date) INTO v_total_sessions
  FROM public.workouts WHERE user_id = _user_id;

  SELECT COALESCE(SUM(
    CASE
      WHEN w.sets IS NOT NULL AND jsonb_typeof(w.sets) = 'array' AND jsonb_array_length(w.sets) > 0 THEN (
        SELECT COALESCE(SUM(COALESCE((s->>'weight')::numeric,0) * COALESCE((s->>'reps')::numeric,0)),0)
        FROM jsonb_array_elements(w.sets) s
      )
      ELSE COALESCE(w.weight,0) * COALESCE(w.reps,0)
    END
  ),0) INTO v_total_volume
  FROM public.workouts w WHERE w.user_id = _user_id;

  SELECT COALESCE(SUM(COALESCE(array_length(completed_keys,1),0)),0) INTO v_total_missions
  FROM public.daily_missions WHERE user_id = _user_id;

  SELECT COUNT(*) INTO v_pb_count FROM (
    SELECT exercise_id,
           MAX(GREATEST(
             COALESCE(weight,0),
             COALESCE((SELECT MAX(COALESCE((s->>'weight')::numeric,0)) FROM jsonb_array_elements(COALESCE(sets,'[]'::jsonb)) s),0)
           )) AS pb
    FROM public.workouts
    WHERE user_id = _user_id
    GROUP BY exercise_id
    HAVING MAX(GREATEST(
             COALESCE(weight,0),
             COALESCE((SELECT MAX(COALESCE((s->>'weight')::numeric,0)) FROM jsonb_array_elements(COALESCE(sets,'[]'::jsonb)) s),0)
           )) > 0
  ) p;

  SELECT COALESCE(MAX(max_combo_reached),0) INTO v_max_combo
  FROM public.user_avatars WHERE user_id = _user_id;

  SELECT COUNT(*) INTO v_rival_wins
  FROM public.rival_battle_rewards WHERE user_id = _user_id AND result = 'win';

  SELECT COUNT(DISTINCT raid_id) INTO v_raid_parts
  FROM public.raid_damage_logs WHERE user_id = _user_id;

  RETURN jsonb_build_object(
    'total_sessions', v_total_sessions,
    'total_volume', v_total_volume,
    'total_missions', v_total_missions,
    'personal_best_count', v_pb_count,
    'max_combo', v_max_combo,
    'rival_wins', v_rival_wins,
    'raid_participations', v_raid_parts
  );
END;
$$;

-- ============== RPC: get quest progress ==============
CREATE OR REPLACE FUNCTION public.get_quest_progress(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_progress record;
  v_values jsonb;
  v_stages jsonb;
  v_completed jsonb;
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
  IF v_user <> auth.uid() AND NOT has_role(auth.uid(),'trainer'::app_role) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user;
  IF NOT FOUND THEN
    INSERT INTO public.user_quest_progress (user_id) VALUES (v_user)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user;
  END IF;

  v_values := public._quest_condition_values(v_user);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'stage_number', s.stage_number,
      'name', s.name,
      'name_before', s.name_before,
      'description', s.description,
      'story_intro', s.story_intro,
      'story_complete', s.story_complete,
      'theme_gradient_from', s.theme_gradient_from,
      'theme_gradient_to', s.theme_gradient_to,
      'theme_dark_from', s.theme_dark_from,
      'theme_dark_to', s.theme_dark_to,
      'theme_icon', s.theme_icon,
      'reward_coins', s.reward_coins,
      'reward_exp', s.reward_exp,
      'reward_title', s.reward_title,
      'reward_badge_key', s.reward_badge_key,
      'reward_frame', s.reward_frame,
      'conditions', (
        SELECT jsonb_agg(jsonb_build_object(
          'condition_type', c.condition_type,
          'target_value', c.target_value,
          'display_label', c.display_label,
          'sort_order', c.sort_order,
          'current_value', COALESCE((v_values->>c.condition_type)::numeric, 0)
        ) ORDER BY c.sort_order)
        FROM public.quest_stage_conditions c WHERE c.stage_id = s.id
      )
    ) ORDER BY s.stage_number
  ) INTO v_stages
  FROM public.quest_stages s;

  SELECT COALESCE(jsonb_agg(stage_id ORDER BY stage_id), '[]'::jsonb) INTO v_completed
  FROM public.user_quest_stage_completions WHERE user_id = v_user;

  RETURN jsonb_build_object(
    'current_stage', v_progress.current_stage,
    'stages', COALESCE(v_stages, '[]'::jsonb),
    'condition_values', v_values,
    'completed_stage_ids', v_completed
  );
END;
$$;

-- ============== RPC: complete quest stage ==============
CREATE OR REPLACE FUNCTION public.complete_quest_stage(p_user_id uuid, p_stage_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  v_user := COALESCE(p_user_id, auth.uid());
  IF v_user IS NULL THEN RAISE EXCEPTION '認証が必要です'; END IF;
  IF v_user <> auth.uid() AND NOT has_role(auth.uid(),'trainer'::app_role) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_stage FROM public.quest_stages WHERE id = p_stage_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ステージが見つかりません'; END IF;

  -- Verify all conditions
  v_values := public._quest_condition_values(v_user);
  SELECT COUNT(*) INTO v_unmet FROM public.quest_stage_conditions c
  WHERE c.stage_id = p_stage_id
    AND COALESCE((v_values->>c.condition_type)::numeric, 0) < c.target_value;
  IF v_unmet > 0 THEN
    RAISE EXCEPTION 'すべての条件を満たしていません';
  END IF;

  -- Insert completion (idempotent)
  INSERT INTO public.user_quest_stage_completions (user_id, stage_id)
  VALUES (v_user, p_stage_id)
  ON CONFLICT (user_id, stage_id) DO NOTHING;

  -- Ensure avatar
  INSERT INTO public.user_avatars (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;

  -- EXP via log
  INSERT INTO public.avatar_exp_logs (user_id, exp_amount, reason, reference_date)
  VALUES (v_user, v_stage.reward_exp, 'quest_stage|' || p_stage_id::text, CURRENT_DATE)
  ON CONFLICT (user_id, reason, reference_date) DO NOTHING;

  -- Recalc level
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

  -- Title
  IF v_stage.reward_title IS NOT NULL THEN
    INSERT INTO public.user_titles (user_id, title_key)
    VALUES (v_user, v_stage.reward_title)
    ON CONFLICT (user_id, title_key) DO NOTHING;
  END IF;

  -- Badge
  IF v_stage.reward_badge_key IS NOT NULL THEN
    INSERT INTO public.avatar_achievements (user_id, achievement_key)
    VALUES (v_user, v_stage.reward_badge_key)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Frame (stage 8): grant the kingdom hero frame and auto-equip if no frame
  IF v_stage.reward_frame THEN
    UPDATE public.user_avatars
    SET equipped_frame = COALESCE(equipped_frame, 'quest_kingdom_hero'),
        updated_at = now()
    WHERE user_id = v_user;
  END IF;

  -- Bump current stage
  SELECT * INTO v_progress FROM public.user_quest_progress WHERE user_id = v_user FOR UPDATE;
  IF v_progress.current_stage = p_stage_id THEN
    UPDATE public.user_quest_progress
    SET current_stage = LEAST(p_stage_id + 1, 8),
        updated_at = now()
    WHERE user_id = v_user;
  END IF;

  RETURN jsonb_build_object(
    'stage_id', p_stage_id,
    'reward_coins', v_stage.reward_coins,
    'reward_exp', v_stage.reward_exp,
    'reward_title', v_stage.reward_title,
    'reward_badge_key', v_stage.reward_badge_key,
    'reward_frame', v_stage.reward_frame,
    'next_stage', LEAST(p_stage_id + 1, 8),
    'leveled_up', v_new_level > COALESCE(v_old_level,1),
    'all_complete', p_stage_id = 8
  );
END;
$$;

-- ============== RPC: initialize quest progress (trainer only) ==============
CREATE OR REPLACE FUNCTION public.initialize_quest_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_stage record;
  v_values jsonb;
  v_unmet int;
  v_users int := 0;
  v_completions int := 0;
  v_target_stage int;
BEGIN
  IF NOT has_role(auth.uid(),'trainer'::app_role) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  FOR v_user IN SELECT user_id FROM public.profiles
  LOOP
    INSERT INTO public.user_quest_progress (user_id) VALUES (v_user.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    v_users := v_users + 1;

    v_values := public._quest_condition_values(v_user.user_id);
    v_target_stage := 1;

    FOR v_stage IN SELECT * FROM public.quest_stages ORDER BY stage_number
    LOOP
      SELECT COUNT(*) INTO v_unmet FROM public.quest_stage_conditions c
      WHERE c.stage_id = v_stage.id
        AND COALESCE((v_values->>c.condition_type)::numeric, 0) < c.target_value;
      EXIT WHEN v_unmet > 0;

      INSERT INTO public.user_quest_stage_completions (user_id, stage_id)
      VALUES (v_user.user_id, v_stage.id)
      ON CONFLICT (user_id, stage_id) DO NOTHING;
      v_completions := v_completions + 1;
      v_target_stage := LEAST(v_stage.stage_number + 1, 8);

      -- grant reward title/badge silently (no coins/exp on auto-init to avoid double-counting)
      IF v_stage.reward_title IS NOT NULL THEN
        INSERT INTO public.user_titles (user_id, title_key)
        VALUES (v_user.user_id, v_stage.reward_title)
        ON CONFLICT (user_id, title_key) DO NOTHING;
      END IF;
      IF v_stage.reward_badge_key IS NOT NULL THEN
        INSERT INTO public.avatar_achievements (user_id, achievement_key)
        VALUES (v_user.user_id, v_stage.reward_badge_key)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    UPDATE public.user_quest_progress
    SET current_stage = v_target_stage, updated_at = now()
    WHERE user_id = v_user.user_id AND current_stage < v_target_stage;
  END LOOP;

  RETURN jsonb_build_object('users', v_users, 'completions', v_completions);
END;
$$;
