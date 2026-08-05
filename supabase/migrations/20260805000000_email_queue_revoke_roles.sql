-- ============================================================================
-- メールキューのRPCから anon / authenticated の EXECUTE を剥がす
-- ============================================================================
--
-- 2026-08-05、相談ボード（兄弟アプリ）が `pg_proc.proacl` を実際に見て発見。
--
-- ── 何が起きていたか ────────────────────────────────────────────
-- email_infra のマイグレーションは、キュー操作RPCをこう保護していた:
--
--   REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
--   GRANT  EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) TO service_role;
--
-- **これでは塞がっていない。**
--
-- Supabase は初期設定で
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
-- を入れている。つまり public スキーマに関数を作った瞬間、
-- **anon と authenticated に「明示の」EXECUTE が付く。**
--
-- そして **`REVOKE ... FROM PUBLIC` は名前付きロールへの明示 GRANT を消さない。**
-- ACL 上 `PUBLIC`（`=X/postgres`）と `anon=X/postgres` は別のエントリだからです。
-- REVOKE は PUBLIC のエントリだけ消して、anon / authenticated はそのまま残る。
--
-- ── なぜ致命的か ────────────────────────────────────────────────
-- 4関数はすべて SECURITY DEFINER で、**関数の中に認可チェックが1つも無い。**
-- GRANT だけが唯一の防御だった。しかも anon キーは全クライアントに埋め込まれている
-- （＝ログインすら要らない）。
--
--   enqueue_email    … 任意の宛先へ任意の本文を、SPF/DKIM を通した自分の正規ドメインから送れる
--   read_email_batch … 配送前のキューが読める。**パスワード再設定リンクが含まれる**
--   delete_email     … 配送前のメールを消せる
--   move_to_dlq      … 同上
--
-- ── 注意 ────────────────────────────────────────────────────────
-- 同一シグネチャの `CREATE OR REPLACE FUNCTION` は既存の権限を保持するので、
-- 上の email_infra を流し直しても anon/authenticated は増えない。
-- **ただし DROP → CREATE や引数の変更で「新しい関数」として作られると、
--   既定権限がまた付く。** そのため新しくキューRPCを足すときは、
-- 定義の直後に必ず `REVOKE ... FROM PUBLIC, anon, authenticated;` を書くこと。
--
-- 検査: security/check.sql の「検査4」、CI は src/test/emailQueueGrants.test.ts
-- ============================================================================

DO $$
DECLARE
  sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.enqueue_email(TEXT, JSONB)',
    'public.read_email_batch(TEXT, INT, INT)',
    'public.delete_email(TEXT, BIGINT)',
    'public.move_to_dlq(TEXT, TEXT, BIGINT, JSONB)'
  ]
  LOOP
    -- email_infra をまだ流していない環境で落ちないようにする
    -- （存在しない関数への REVOKE はエラーになる）
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
      EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', sig);
    END IF;
  END LOOP;
END $$;
