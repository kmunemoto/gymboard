
-- 1. Allow 'costume' in equipment_items.item_type and raid_reward_items.category
ALTER TABLE public.equipment_items DROP CONSTRAINT IF EXISTS equipment_items_item_type_check;
ALTER TABLE public.equipment_items ADD CONSTRAINT equipment_items_item_type_check
  CHECK (item_type = ANY (ARRAY['weapon','shield','amulet','top','bottom','accessory','companion_egg','costume']));

ALTER TABLE public.raid_reward_items DROP CONSTRAINT IF EXISTS raid_reward_items_category_check;
ALTER TABLE public.raid_reward_items ADD CONSTRAINT raid_reward_items_category_check
  CHECK (category = ANY (ARRAY['weapon','background','title','badge','costume']));

-- 2. Add image columns to announcements
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS image_url2 text;

-- 3. Insert MVP costumes into equipment_items
INSERT INTO public.equipment_items (item_key, item_name, item_type, rarity, atk_bonus, def_bonus, hp_bonus, source, icon_name, image_path) VALUES
  ('goblin_slayer_costume', 'ゴブリンスレイヤーの鎧', 'costume', 'legendary', 15, 20, 30, 'レイドMVP', 'Shield', 'costumes/goblin_slayer_male.png'),
  ('goblin_princess_costume', 'ゴブリンプリンセスドレス', 'costume', 'legendary', 10, 15, 40, 'レイドMVP', 'Crown', 'costumes/goblin_princess_female.png')
ON CONFLICT (item_key) DO NOTHING;

-- 4. Update existing goblin MVP weapon reward to male costume
UPDATE public.raid_reward_items
SET item_key = 'goblin_slayer_costume',
    category = 'costume',
    name = 'ゴブリンスレイヤーの鎧',
    description = 'ゴブリン討伐の男性MVPに授与される伝説の鎧。全身が暗黒の装甲に覆われる。',
    image_url = 'https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/costumes/goblin_slayer_male.png'
WHERE item_key = 'goblin_dagger';

-- 5. Insert female MVP costume reward item linked to most recent goblin raid
INSERT INTO public.raid_reward_items (raid_boss_id, item_key, category, name, description, image_url, required_rank, theme_color)
SELECT
  (SELECT id FROM public.raid_bosses WHERE boss_name ILIKE '%ゴブリン%' ORDER BY start_date DESC LIMIT 1),
  'goblin_princess_costume',
  'costume',
  'ゴブリンプリンセスドレス',
  'ゴブリン討伐の女性MVPに授与される伝説の鎧。全身がダークメタリックの装甲に覆われる。',
  'https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/costumes/goblin_princess_female.png',
  'mvp',
  '#4ADE80'
ON CONFLICT (item_key) DO NOTHING;

-- 6. Insert announcement
INSERT INTO public.announcements (title, body, icon, image_url, image_url2) VALUES (
  'レイドボスMVP限定コスチューム登場！',
  E'レイドボスを討伐した際、男性MVP・女性MVP各1名に限定コスチュームを配布します！\n\n【ゴブリン討伐MVP報酬】\n男性MVP: ゴブリンスレイヤーの鎧\n女性MVP: ゴブリンプリンセスドレス\n\n全身が伝説の装甲に覆われる特別なコスチュームです。コインショップでは購入できないMVP限定アイテムです。\n\nたくさんトレーニングしてMVPを目指しましょう！',
  'Gift',
  'https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/costumes/goblin_slayer_male.png',
  'https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars/costumes/goblin_princess_female.png'
);

-- 7. Update distribute_raid_rewards: gender-specific MVP costume for goblin
CREATE OR REPLACE FUNCTION public.distribute_raid_rewards(p_raid_boss_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_boss record;
  v_total int;
  v_total_male int;
  v_total_female int;
  v_male_max int;
  v_female_max int;
  v_contributor_cutoff int;
  v_participants int := 0;
  v_contributors int := 0;
  v_mvps int := 0;
  v_male_mvps int := 0;
  v_female_mvps int := 0;
  v_items_granted int := 0;
  v_equipment_key text := NULL;
  v_male_mvp_costume text := NULL;
  v_female_mvp_costume text := NULL;
  ranked_user record;
  reward_item record;
  v_rank text;
  v_male_mvp_info jsonb := '[]'::jsonb;
  v_female_mvp_info jsonb := '[]'::jsonb;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(), 'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_boss FROM public.raid_bosses WHERE id = p_raid_boss_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ボスが見つかりません'; END IF;
  IF NOT v_boss.defeated THEN RAISE EXCEPTION 'ボスはまだ撃破されていません'; END IF;

  -- Determine equipment by boss name (legacy: granted to all participants)
  IF v_boss.boss_name ILIKE '%ドラゴン%' OR v_boss.boss_name ILIKE '%dragon%' THEN
    v_equipment_key := 'dragon_fang';
  ELSIF v_boss.boss_name ILIKE '%デスナイト%' OR v_boss.boss_name ILIKE '%death%' THEN
    v_equipment_key := NULL;
  END IF;

  -- Gender-specific MVP costumes by boss
  IF v_boss.boss_name ILIKE '%ゴブリン%' OR v_boss.boss_name ILIKE '%goblin%' THEN
    v_male_mvp_costume := 'goblin_slayer_costume';
    v_female_mvp_costume := 'goblin_princess_costume';
  END IF;

  CREATE TEMP TABLE _agg ON COMMIT DROP AS
  SELECT
    rdl.user_id,
    SUM(rdl.damage)::int AS total_damage,
    ua.gender AS gender,
    COALESCE(p.display_name, '') AS display_name
  FROM public.raid_damage_logs rdl
  LEFT JOIN public.user_avatars ua ON ua.user_id = rdl.user_id
  LEFT JOIN public.profiles p ON p.user_id = rdl.user_id
  WHERE rdl.raid_id = p_raid_boss_id
  GROUP BY rdl.user_id, ua.gender, p.display_name
  HAVING SUM(rdl.damage) >= 1;

  SELECT COUNT(*) INTO v_total FROM _agg;
  IF v_total = 0 THEN
    RETURN jsonb_build_object(
      'participants',0,'contributors',0,'mvps',0,
      'male_participants',0,'female_participants',0,
      'male_mvps','[]'::jsonb,'female_mvps','[]'::jsonb,
      'items_granted',0
    );
  END IF;

  SELECT COUNT(*) INTO v_total_male FROM _agg WHERE gender = 'male';
  SELECT COUNT(*) INTO v_total_female FROM _agg WHERE gender = 'female';
  SELECT MAX(total_damage) INTO v_male_max FROM _agg WHERE gender = 'male';
  SELECT MAX(total_damage) INTO v_female_max FROM _agg WHERE gender = 'female';
  v_contributor_cutoff := CEIL(v_total::numeric / 2.0)::int;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'display_name', display_name, 'damage', total_damage)), '[]'::jsonb)
    INTO v_male_mvp_info FROM _agg WHERE gender = 'male' AND total_damage = v_male_max AND v_male_max IS NOT NULL;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'display_name', display_name, 'damage', total_damage)), '[]'::jsonb)
    INTO v_female_mvp_info FROM _agg WHERE gender = 'female' AND total_damage = v_female_max AND v_female_max IS NOT NULL;

  FOR ranked_user IN
    SELECT user_id, total_damage, gender,
           ROW_NUMBER() OVER (ORDER BY total_damage DESC) AS rnk
    FROM _agg
  LOOP
    v_participants := v_participants + 1;
    IF ranked_user.gender = 'male' AND v_male_max IS NOT NULL AND ranked_user.total_damage = v_male_max THEN
      v_rank := 'mvp'; v_mvps := v_mvps + 1; v_male_mvps := v_male_mvps + 1; v_contributors := v_contributors + 1;
    ELSIF ranked_user.gender = 'female' AND v_female_max IS NOT NULL AND ranked_user.total_damage = v_female_max THEN
      v_rank := 'mvp'; v_mvps := v_mvps + 1; v_female_mvps := v_female_mvps + 1; v_contributors := v_contributors + 1;
    ELSIF ranked_user.rnk <= v_contributor_cutoff THEN
      v_rank := 'contributor'; v_contributors := v_contributors + 1;
    ELSE
      v_rank := 'participant';
    END IF;

    FOR reward_item IN
      SELECT * FROM public.raid_reward_items
      WHERE raid_boss_id = p_raid_boss_id
        AND (
          required_rank = 'participant'
          OR (required_rank = 'contributor' AND v_rank IN ('contributor','mvp'))
          OR (required_rank = 'mvp' AND v_rank = 'mvp')
        )
    LOOP
      INSERT INTO public.user_raid_rewards (user_id, item_key, raid_boss_id, earned_rank)
      VALUES (ranked_user.user_id, reward_item.item_key, p_raid_boss_id, v_rank)
      ON CONFLICT (user_id, item_key) DO NOTHING;
      IF FOUND THEN v_items_granted := v_items_granted + 1; END IF;

      IF reward_item.category = 'title' THEN
        INSERT INTO public.user_titles (user_id, title_key) VALUES (ranked_user.user_id, reward_item.item_key)
        ON CONFLICT (user_id, title_key) DO NOTHING;
      END IF;
      IF reward_item.category = 'badge' THEN
        INSERT INTO public.avatar_achievements (user_id, achievement_key) VALUES (ranked_user.user_id, reward_item.item_key)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;

    -- Equipment grant for this raid boss (legacy: all participants)
    IF v_equipment_key IS NOT NULL THEN
      PERFORM public.grant_equipment(ranked_user.user_id, v_equipment_key, 'raid');
    END IF;

    -- Gender-specific MVP costume grant
    IF v_rank = 'mvp' THEN
      IF ranked_user.gender = 'male' AND v_male_mvp_costume IS NOT NULL THEN
        PERFORM public.grant_equipment(ranked_user.user_id, v_male_mvp_costume, 'raid_mvp');
      ELSIF ranked_user.gender = 'female' AND v_female_mvp_costume IS NOT NULL THEN
        PERFORM public.grant_equipment(ranked_user.user_id, v_female_mvp_costume, 'raid_mvp');
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'participants', v_participants,
    'male_participants', v_total_male,
    'female_participants', v_total_female,
    'contributors', v_contributors,
    'mvps', v_mvps,
    'male_mvps', v_male_mvp_info,
    'female_mvps', v_female_mvp_info,
    'items_granted', v_items_granted,
    'equipment_key', v_equipment_key,
    'male_mvp_costume', v_male_mvp_costume,
    'female_mvp_costume', v_female_mvp_costume
  );
END;
$function$;
