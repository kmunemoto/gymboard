-- ============================================================================
-- テナント境界の自己診断（読み取り専用）
-- ============================================================================
--
-- 複製元（ジムボード）で 2026-08-03 に見つかったテナント境界の穴が、
-- このデータベースにも残っているかを調べる。**何も変更しない。**
--
-- 使い方: Supabase の SQL エディタ、または Lovable の query_database に
--         このファイルの中身をそのまま貼って実行する。
--
-- 経緯と直し方: security/README.md
--
-- ⚠️ SQL で見えるのは DB 側（RLS・トリガー）だけ。
--    Edge Function 側（穴3）はコードを見る必要がある。README の「検査3」参照。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 検査0: 自分のアプリの「実物のポリシー名」を見る（★最初にこれを見ること）
-- ----------------------------------------------------------------------------
-- **ポリシー名はアプリごとに違います。** 複製元と同じとは限りません。
--
-- 2026-08-03、ピラボードで実際にこうなっていました:
--
--   ジムボード : "Trainers/owners can manage members"
--   ピラボード : "Owner can manage members"
--                USING (EXISTS (SELECT 1 FROM tenants t
--                                WHERE t.id = tenant_members.tenant_id
--                                  AND t.owner_user_id = auth.uid()))
--
-- 穴としては同じですが、**名前が違うと配布された修正SQLが効きません。**
-- `DROP POLICY IF EXISTS "<違う名前>"` は**何も消さずに成功します。エラーも出ません。**
-- 「適用したのに直っていない」が起きます。
--
-- **DROP する前に、必ずここで実物の名前を確認してください。**

SELECT policyname, cmd, permissive, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'tenant_members'
ORDER BY cmd, policyname;

-- 全テナント共通マスタ側も同じ。名前で DROP するので実物を見ること。
SELECT tablename, cmd, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('raid_bosses','raid_reward_items','season_events','season_event_tasks',
                    'season_pass_config','season_pass_levels','avatar_customization_items',
                    'gym_settings')
  AND cmd <> 'SELECT'
ORDER BY tablename, cmd, policyname;


-- ----------------------------------------------------------------------------
-- 検査1: 既知の3つの穴が塞がっているか
-- ----------------------------------------------------------------------------
-- verdict が 1つでも「★要対応」なら、README の手順で塞ぐこと。
--
-- ⚠️ 穴1-a は「FOR ALL のポリシーが**何かある**」ことしか見ません。
--    名前は見ていないので、**塞ぐときは検査0 の実物を使ってください。**

WITH checks(sort_order, item, found, expected, note) AS (
  SELECT 1,
         '穴1-a: tenant_members に FOR ALL のポリシーが残っている',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'tenant_members' AND cmd = 'ALL'),
         0,
         'FOR ALL は INSERT/UPDATE/DELETE をまとめて開ける。他人の user_id を自テナントに入れられる'
  UNION ALL
  SELECT 2,
         '穴1-b: 行の同一性を守るトリガーが無い',
         (SELECT count(*) FROM pg_trigger t
             JOIN pg_class c ON c.oid = t.tgrelid
             JOIN pg_proc  p ON p.oid = t.tgfoid
            WHERE NOT t.tgisinternal
              AND c.relname = 'tenant_members'
              AND p.proname = 'guard_tenant_member_identity'),
         1,
         'RLS の WITH CHECK は更新後の行しか見えない。UPDATE で user_id を差し替える経路はトリガーでしか塞げない'
  UNION ALL
  SELECT 3,
         '穴2-a: 全テナント共通マスタに書き込みポリシーが残っている',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('raid_bosses','raid_reward_items','season_events','season_event_tasks',
                               'season_pass_config','season_pass_levels','avatar_customization_items',
                               'gym_settings')
             AND cmd <> 'SELECT'),
         0,
         'tenant_id を持たないマスタ。trainer は誰でも取れるので「誰でも書ける」と同義になる'
  UNION ALL
  SELECT 4,
         '穴2-b: storage の tenant-logos が user_id 前置に絞られていない',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'storage'
             AND policyname = 'Authenticated avatar uploads scoped to user folder'
             AND with_check LIKE '%tenant-logos/%'
             AND with_check LIKE '%~~%'),
         1,
         'LIKE は pg_policies 上では ~~ と表示される。0 なら未修正か、そもそもポリシーが無い'
)
SELECT
  item,
  found,
  expected,
  CASE WHEN found = expected THEN 'OK' ELSE '★要対応' END AS verdict,
  note
FROM checks
ORDER BY sort_order;


-- ----------------------------------------------------------------------------
-- 検査2: グローバルな trainer ロールだけで書けるポリシーの洗い出し
-- ----------------------------------------------------------------------------
-- **検査1 が全部 OK でも、これは別途実行すること。**
-- 検査1 はジムボードで見つかったテーブルを名指しで見るだけ。
-- こちらは**テーブルを列挙せず全ポリシーを走査**するので、
-- そのアプリで独自に増えたテーブルも見つかる。
--
-- has_role が見る public.user_roles に tenant_id は無い。
-- つまり trainer はテナント横断のグローバル権限で、しかも誰でも取れる。
-- 書き込みポリシーが has_role(trainer) に頼っているのに、
-- テナント絞りも本人限定も AND されていなければ「誰でも書ける」と同義になる。
--
-- ⚠️ 安全側に倒してある（見逃すより多めに出す）。
--    出た行は1件ずつ目で確認すること。qual / with_check を読めば判断できる。
--
-- 0行なら OK。

WITH pol AS (
  SELECT
    tablename,
    policyname,
    cmd,
    coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
  FROM pg_policies
  WHERE schemaname = 'public'
    AND permissive = 'PERMISSIVE'
    AND cmd <> 'SELECT'
)
SELECT tablename, policyname, cmd, expr
FROM pol
WHERE expr LIKE '%has_role%'
  AND expr LIKE '%trainer%'
  -- テナント絞り
  AND expr NOT LIKE '%get_my_tenant_id%'
  AND expr NOT LIKE '%has_tenant_role%'
  AND expr NOT LIKE '%is_tenant_member%'
  AND expr NOT LIKE '%shares_tenant_with_me%'
  -- 本人限定
  AND expr NOT LIKE '%auth.uid() = user_id%'
  AND expr NOT LIKE '%user_id = auth.uid()%'
ORDER BY tablename, cmd, policyname;


-- ----------------------------------------------------------------------------
-- 検査3: RESTRICTIVE なテナント絞りが付いているテーブルの一覧
-- ----------------------------------------------------------------------------
-- 検査2 で出た行のうち、テーブル自体に RESTRICTIVE のテナント絞りが
-- あるものは AND で潰れるので安全。ここに載っていれば見逃してよい。
--
-- 検査2 の結果と突き合わせて使う。

SELECT DISTINCT tablename
FROM pg_policies
WHERE schemaname = 'public'
  AND permissive = 'RESTRICTIVE'
  AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      ~ '(get_my_tenant_id|has_tenant_role|is_tenant_member|shares_tenant_with_me)'
ORDER BY tablename;
