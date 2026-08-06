-- ============================================================================
-- RLS ポリシーが使う述語の EXECUTE を authenticated に戻す（穴8の事故の修復）
-- ============================================================================
--
-- 20260806120000 で、呼び出し元が0件だった26関数から
-- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` した。
-- そのうち3つは **RLS ポリシーの中で使われている述語**だった。
--
-- 同マイグレーションのコメントには
--
--     「ポリシーの中からは所有者権限で評価されるので影響しない」
--
-- と書いてあったが、**これは誤り**。2026-08-06 に本番で実測して確認した:
--
--     BEGIN;
--     SET LOCAL request.jwt.claims = '{"sub":"<user>","role":"authenticated"}';
--     SET LOCAL ROLE authenticated;
--     SELECT count(*) FROM public.announcement_reads;
--     -- ERROR: 42501: permission denied for function shares_tenant_with_me
--
-- **RLS のポリシー式は、クエリを投げたロールの権限で評価される。**
-- SECURITY DEFINER であっても、EXECUTE 権限のチェックは呼び出し元に対して行われる
-- （DEFINER が効くのは「関数の中身」であって「関数を呼べるかどうか」ではない）。
--
-- 同じ理屈で 20260806120000 の第1章（anon 向けポリシーを authenticated に絞ってから
-- has_role の anon 権限を剥がす）が必要だった。**あれが正しくて、こちらが間違っていた。**
--
-- ── 影響 ────────────────────────────────────────────────────
--
--   shares_tenant_with_me   39ポリシー（announcement_reads ほか tenant_user_isolation）
--   is_tenant_member         3ポリシー（tenant_members）
--   has_tenant_role          2ポリシー（tenant_members の owner 限定の書き込み）
--
-- ログイン済みのユーザーが対象テーブルを読むと 0件ではなく **42501 で失敗する**。
-- つまり**アプリのほぼ全画面が落ちる**。
--
-- ── anon からは剥がしたままにする ──────────────────────────
--
-- 上記44ポリシーはすべて `TO authenticated` なので、anon がこれらを評価することは無い。
-- anon に対する REVOKE は正しいので**戻さない**（PostgREST 経由で
-- `has_tenant_role(other_tenant, other_user, ...)` を直接叩かれるのを塞ぐのが目的）。
--
--   is_tenant_over_limit は戻さない。ポリシーからは使われておらず、
--   呼び出し元は get_tenant_limit_status / enforce_tenant_plan_limit の2つだけで、
--   **どちらも SECURITY DEFINER なので中の呼び出しは所有者権限で通る。**
--
-- 検査: src/test/anonRpcExposure.test.ts の
--       「RLS ポリシーが使う関数を authenticated から剥がしていない」
-- ============================================================================

DO $$
DECLARE
  sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.shares_tenant_with_me(uuid)',
    'public.is_tenant_member(uuid, uuid)',
    'public.has_tenant_role(uuid, uuid, text[])'
  ]
  LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig);
      RAISE NOTICE 'restored EXECUTE to authenticated: %', sig;
    END IF;
  END LOOP;
END $$;
