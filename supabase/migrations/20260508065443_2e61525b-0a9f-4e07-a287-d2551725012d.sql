
-- 1. Columns
ALTER TABLE public.user_avatars
  ADD COLUMN IF NOT EXISTS equipped_weapon text,
  ADD COLUMN IF NOT EXISTS equipped_background text;

ALTER TABLE public.raid_bosses
  ADD COLUMN IF NOT EXISTS theme_color text;

-- 2. raid_reward_items
CREATE TABLE IF NOT EXISTS public.raid_reward_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raid_boss_id uuid REFERENCES public.raid_bosses(id) ON DELETE CASCADE,
  item_key text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('weapon','background','title','badge')),
  name text NOT NULL,
  description text,
  image_url text,
  required_rank text NOT NULL CHECK (required_rank IN ('participant','contributor','mvp')),
  theme_color text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.raid_reward_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated views reward items"
  ON public.raid_reward_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Trainers manage reward items insert"
  ON public.raid_reward_items FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers manage reward items update"
  ON public.raid_reward_items FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'trainer'::app_role));

CREATE POLICY "Trainers manage reward items delete"
  ON public.raid_reward_items FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'trainer'::app_role));

-- 3. user_raid_rewards
CREATE TABLE IF NOT EXISTS public.user_raid_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  item_key text NOT NULL,
  raid_boss_id uuid REFERENCES public.raid_bosses(id) ON DELETE CASCADE,
  earned_rank text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_key)
);

ALTER TABLE public.user_raid_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own raid rewards"
  ON public.user_raid_rewards FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'trainer'::app_role));

-- No INSERT policy: only SECURITY DEFINER function distribute_raid_rewards can write.

-- 4. Update goblin boss
UPDATE public.raid_bosses
  SET theme_color = '#4ADE80',
      boss_image_url = COALESCE(boss_image_url, '/raid-bosses/goblin.png')
  WHERE boss_name ILIKE '%ゴブリン%' OR boss_name ILIKE '%goblin%';

-- 5. Seed reward items (idempotent via item_key UNIQUE)
INSERT INTO public.raid_reward_items (raid_boss_id, item_key, category, name, description, image_url, required_rank, theme_color)
SELECT
  (SELECT id FROM public.raid_bosses WHERE boss_name ILIKE '%ゴブリン%' OR boss_name ILIKE '%goblin%' ORDER BY start_date DESC LIMIT 1),
  v.item_key, v.category, v.name, v.description, v.image_url, v.required_rank, v.theme_color
FROM (VALUES
  ('goblin_badge','badge','ゴブリン討伐記念','初代レイドボス・ゴブリンの撃破に貢献',NULL,'participant','#4ADE80'),
  ('goblin_title','title','ゴブリンスレイヤー','ゴブリン撃破の貢献者に授与される称号',NULL,'contributor','#4ADE80'),
  ('goblin_bg','background','森の洞窟','ゴブリンの棲む森の洞窟から漂う魔法のオーラ','/raid-rewards/goblin_bg.png','contributor','#4ADE80'),
  ('goblin_dagger','weapon','ゴブリンの短剣','ゴブリン討伐MVPに授与される伝説の短剣','/raid-rewards/goblin_dagger.png','mvp','#4ADE80')
) AS v(item_key, category, name, description, image_url, required_rank, theme_color)
ON CONFLICT (item_key) DO NOTHING;

INSERT INTO public.raid_reward_items (item_key, category, name, description, image_url, required_rank, theme_color)
VALUES
  ('orc_badge','badge','オーク討伐記念','オーク戦士の撃破に貢献',NULL,'participant','#F97316'),
  ('orc_title','title','オークバスター','オーク撃破の貢献者に授与される称号',NULL,'contributor','#F97316'),
  ('orc_bg','background','燃える戦場','オーク戦士との激闘の炎','/raid-rewards/orc_bg.png','contributor','#F97316'),
  ('orc_axe','weapon','オークの戦斧','オーク討伐MVPに授与される巨大戦斧','/raid-rewards/orc_axe.png','mvp','#F97316'),
  ('dragon_badge','badge','ドラゴン討伐記念','ドラゴンの撃破に貢献',NULL,'participant','#EAB308'),
  ('dragon_title','title','ドラゴンキラー','ドラゴン撃破の貢献者に授与される称号',NULL,'contributor','#EAB308'),
  ('dragon_bg','background','ドラゴンの翼','ドラゴンの力を宿すオーラ','/raid-rewards/dragon_bg.png','contributor','#EAB308'),
  ('dragon_sword','weapon','ドラゴンの炎剣','ドラゴン討伐MVPに授与される炎の剣','/raid-rewards/dragon_sword.png','mvp','#EAB308')
ON CONFLICT (item_key) DO NOTHING;

-- 6. distribute_raid_rewards RPC
CREATE OR REPLACE FUNCTION public.distribute_raid_rewards(p_raid_boss_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_boss record;
  v_total int;
  v_max int;
  v_contributor_cutoff int;
  v_participants int := 0;
  v_contributors int := 0;
  v_mvps int := 0;
  v_items_granted int := 0;
  r record;
  ranked_user record;
  reward_item record;
  v_rank text;
BEGIN
  IF NOT (auth.role() = 'service_role' OR has_role(auth.uid(), 'trainer'::app_role)) THEN
    RAISE EXCEPTION '権限がありません';
  END IF;

  SELECT * INTO v_boss FROM public.raid_bosses WHERE id = p_raid_boss_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ボスが見つかりません'; END IF;
  IF NOT v_boss.defeated THEN RAISE EXCEPTION 'ボスはまだ撃破されていません'; END IF;

  -- Aggregate damage per user
  CREATE TEMP TABLE _agg ON COMMIT DROP AS
  SELECT user_id, SUM(damage)::int AS total_damage
  FROM public.raid_damage_logs
  WHERE raid_id = p_raid_boss_id
  GROUP BY user_id
  HAVING SUM(damage) >= 1;

  SELECT COUNT(*) INTO v_total FROM _agg;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('participants',0,'contributors',0,'mvps',0,'items_granted',0);
  END IF;

  SELECT MAX(total_damage) INTO v_max FROM _agg;
  -- contributor cutoff = top 50% rounded up
  v_contributor_cutoff := CEIL(v_total::numeric / 2.0)::int;

  FOR ranked_user IN
    SELECT user_id, total_damage,
           ROW_NUMBER() OVER (ORDER BY total_damage DESC) AS rnk
    FROM _agg
  LOOP
    IF ranked_user.total_damage = v_max THEN
      v_rank := 'mvp'; v_mvps := v_mvps + 1; v_contributors := v_contributors + 1; v_participants := v_participants + 1;
    ELSIF ranked_user.rnk <= v_contributor_cutoff THEN
      v_rank := 'contributor'; v_contributors := v_contributors + 1; v_participants := v_participants + 1;
    ELSE
      v_rank := 'participant'; v_participants := v_participants + 1;
    END IF;

    -- Grant all items where required_rank is satisfied by user's rank
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

      IF FOUND THEN
        v_items_granted := v_items_granted + 1;
      END IF;

      -- mirror title to user_titles
      IF reward_item.category = 'title' THEN
        INSERT INTO public.user_titles (user_id, title_key)
        VALUES (ranked_user.user_id, reward_item.item_key)
        ON CONFLICT (user_id, title_key) DO NOTHING;
      END IF;

      -- mirror badge to avatar_achievements
      IF reward_item.category = 'badge' THEN
        INSERT INTO public.avatar_achievements (user_id, achievement_key)
        VALUES (ranked_user.user_id, reward_item.item_key)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'participants', v_participants,
    'contributors', v_contributors,
    'mvps', v_mvps,
    'items_granted', v_items_granted
  );
END;
$$;

-- 7. Announcements
UPDATE public.announcements
SET body = E'5月18日（日）〜24日（土）の1週間、ジム初のレイドボスが出現します！\n\n【レイドボスとは？】\nジム全体の総挙上量でボスのHPを削る協力イベントです。\nあなたのトレーニングが、そのままボスへのダメージになります。\n\n【レベルが高いほど有利！】\nルーキー：ダメージ1.0倍\nレギュラー：ダメージ1.2倍\nアスリート：ダメージ1.5倍\nエリート：ダメージ1.8倍\nレジェンド：ダメージ2.0倍\n\n【撃破報酬 - 貢献度に応じた限定アイテム！】\n参加者全員：限定バッジ + EXP + コイン\n上位50%：限定称号「ゴブリンスレイヤー」+ 限定背景エフェクト\nダメージ1位（MVP）：伝説の武器「ゴブリンの短剣」\n\n限定アイテムはアバターに装備できます！\nこのボスでしか手に入らないアイテムなので、ぜひ全力で挑みましょう！\n\nホーム画面のRAID BOSSカードで出現までのカウントダウンを確認できます。'
WHERE title = '5/18〜 初のレイドボスが出現！';

INSERT INTO public.announcements (title, body, icon, target, published_at)
SELECT
  'レイド限定アイテムが登場！',
  E'レイドボスを倒すと、貢献度に応じて限定アイテムが手に入ります！\n\n【限定アイテムの種類】\n限定バッジ：参加するだけでもらえる記念バッジ\n限定称号：上位50%の貢献者に授与\n限定背景：アバターの背景にレイドの戦場を飾れる\n限定武器：MVPだけがもらえる最強の証\n\n【装備方法】\nアバター詳細画面の「レイド装備」から武器と背景を装備できます。\n装備するとホーム画面やシェアカードに反映されます。\n\n毎月違うボスが出現するので、限定アイテムをコレクションしましょう！',
  'Trophy', 'all', now()
WHERE NOT EXISTS (SELECT 1 FROM public.announcements WHERE title = 'レイド限定アイテムが登場！');
