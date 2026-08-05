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


-- ----------------------------------------------------------------------------
-- 検査4: anon / authenticated から叩ける SECURITY DEFINER 関数（★穴6）
-- ----------------------------------------------------------------------------
-- 2026-08-05、相談ボードが `pg_proc.proacl` を実際に見て発見した。
--
-- メールキューのRPCは、マイグレーション上はこう保護されている:
--
--   REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
--   GRANT  EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
--
-- **これでは塞がっていない。**
-- Supabase は `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon, authenticated`
-- を入れているので、public スキーマに関数を作った瞬間、両ロールに**明示の** EXECUTE が付く。
-- そして **`REVOKE ... FROM PUBLIC` は名前付きロールへの明示 GRANT を消さない**
-- （ACL 上 `=X/postgres`（PUBLIC）と `anon=X/postgres` は別のエントリ）。
--
-- 4関数はすべて SECURITY DEFINER で**関数内に認可チェックが無い**（GRANT だけが防御）。
-- anon キーは全クライアントに埋め込まれているので、**ログインすら要らない。**
--
--   enqueue_email    … 任意の宛先へ任意の本文を、SPF/DKIM を通した自分の正規ドメインから送れる
--   read_email_batch … 配送前のキューが読める。**パスワード再設定リンクが含まれる**
--   delete_email     … 配送前のメールを消せる
--   move_to_dlq      … 同上

SELECT
  p.proname,
  p.prosecdef AS security_definer,
  coalesce(p.proacl::text, '(既定＝PUBLIC に EXECUTE)') AS acl,
  CASE
    WHEN p.proacl IS NULL THEN '★要対応（既定のまま＝誰でも叩ける）'
    WHEN p.proacl::text LIKE '%anon=%' OR p.proacl::text LIKE '%authenticated=%'
      THEN '★要対応'
    ELSE 'OK'
  END AS verdict
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('enqueue_email','read_email_batch','delete_email','move_to_dlq')
ORDER BY p.proname;

-- 塞ぎ方（★要対応 が出たときだけ実行。これは書き込みです）:
--
--   REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB)             FROM PUBLIC, anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION public.read_email_batch(TEXT, INT, INT)       FROM PUBLIC, anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION public.delete_email(TEXT, BIGINT)             FROM PUBLIC, anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
--
-- ⚠️ **引数の型は自分のDBの実物に合わせること。** シグネチャが違うと
--    「そんな関数は無い」で落ちるか、別のオーバーロードだけ剥がして安心してしまう。
--    上の検査の `proname` と `pg_get_function_identity_arguments(p.oid)` で確認できる。
--
-- 流したあと、**もう一度この検査を実行して `OK` になったことを見ること。**
-- 「流した」ではなく「消えた」まで確認する。
--
-- マイグレーションにも入れること:
--   supabase/migrations/20260805000000_email_queue_revoke_roles.sql
-- CI での再発防止:
--   src/test/emailQueueGrants.test.ts


-- ----------------------------------------------------------------------------
-- 検査5: 同じ形が他に無いかの棚卸し（SECURITY DEFINER 全件）
-- ----------------------------------------------------------------------------
-- **検査4 が OK でも、これは別途実行すること。**
-- 検査4 はメールキューの4関数を名指しで見るだけ。こちらは全件を洗う。
--
-- 危険なのは「**関数の中で auth.uid() を見ておらず**、かつ anon から叩ける」もの。
-- 内部で auth.uid() を見る関数（join_tenant_as_staff_with_invite_code 等）は
-- anon から呼んでも成立しないので、ここに出ても問題ありません。
--
-- ⚠️ 安全側に倒してある（見逃すより多めに出す）。出た行は1件ずつ目で確認すること。

SELECT
  p.proname,
  coalesce(p.proacl::text, '(既定＝PUBLIC に EXECUTE)') AS acl,
  (p.prosrc ~ 'auth\.uid\(\)') AS checks_caller
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND (p.proacl IS NULL
       OR p.proacl::text LIKE '%anon=%'
       OR p.proacl::text LIKE '%authenticated=%')
  AND NOT (p.prosrc ~ 'auth\.uid\(\)')
ORDER BY p.proname;


-- ----------------------------------------------------------------------------
-- 検査6: DB内の関数が「他プロジェクト」を叩いていないか（★穴7）
-- ----------------------------------------------------------------------------
-- 2026-08-05、相談ボードが実DBを見て発見。**8プロジェクトを実測して確認済み。**
--
-- remix でできた兄弟アプリの**DB内の関数**に、remix 元のプロジェクトの URL が残る。
-- `setup_email_infra`（Lovable が Management API で流すもの）は
-- `email_queue_*` は自分の ref に書き換えるが、
-- **`notify_trainer_new_signup` は書き換えない。**
--
-- 何が起きるか:
--   その関数は vault から**自分の service_role キー**を取り出し、
--   **他プロジェクトの Edge Function へ Authorization ヘッダで送る。**
--   `notify_trainer_new_signup` は加えて**登録者のメールアドレスと表示名**も送る。
--
-- service_role キーは RLS を無視して全データを読み書きできる鍵です。
-- 別プロジェクトに渡ってよいものではありません。
--
-- ⚠️ なぜリポジトリの検査では届かないか:
--   `src/test/edgeFunctionProjectRef.test.ts` は `supabase/functions/` しか見ません。
--   これらの関数は**リポジトリのマイグレーションに存在しません**（Management API 製）。
--   **リポジトリをどれだけ綺麗にしても素通りします。実DBを見る以外に方法がありません。**
--
-- ⚠️ `public` スキーマだけを見ないこと。net / cron / vault に仕込まれると見落とします。

SELECT
  n.nspname AS schema_name,
  p.proname,
  (regexp_matches(p.prosrc, 'https?://([a-z0-9]{20})\.supabase\.co', 'g'))[1] AS project_ref
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND p.prosrc ~ 'supabase[.]co'
ORDER BY n.nspname, p.proname;

-- 出た `project_ref` が**自分の project ref 以外**なら ★要対応。
-- 自分の ref は `.env` の `VITE_SUPABASE_PROJECT_ID`、または Supabase の URL で確認できます。
--
-- 直し方: その関数を `CREATE OR REPLACE` で流し直し、URL を自分の ref に書き換える。
--   使っていない関数なら `DROP FUNCTION` のほうが安全です
--   （service_role キーがヘッダに載る設計自体を残さない）。
--
-- ⚠️ **直したら、この検査をもう一度流して消えたことを確認すること。**
-- ⚠️ **1本直して終わりにしないこと。** 相談ボードは検査を足した直後に2本目を見つけました。


-- ----------------------------------------------------------------------------
-- 検査7: cron の POST 先（⚠️ このファイルの最後に置いてあります）
-- ----------------------------------------------------------------------------
-- ⚠️ **pg_cron を入れていない環境ではエラーになります。**
--    「relation "cron.job" does not exist」が出たら、cron を使っていないだけなので
--    無視してください。**上の検査1〜6の結果はすでに出ています**（だから最後に置いています）。
--
-- ⚠️ cron.job は**実行ロールごとに見える行が違います。空でも「無い」とは限りません。**
--    メールの cron は「必要なときだけ張って、キューが空になったら外す」動きをするので、
--    平常時は空に見えるのが正常です（配送の確認は email_send_log の pending → sent で）。

SELECT
  jobid, jobname, schedule, username, active,
  (regexp_matches(command, 'https?://([a-z0-9]{20})\.supabase\.co', 'g'))[1] AS project_ref
FROM cron.job
WHERE command ~ 'supabase[.]co'
ORDER BY jobid;
