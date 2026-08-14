-- メールキューの RPC が未ログイン（anon）から実行できていたのを塞ぐ（2026-08-14）。
--
-- 業種フォーク（ゴルフボード）が自分の本番DBで発見して報告。
-- **権限表を見るだけで終わらせず、anon を演じて実際に呼んで再現させた**:
--
--   BEGIN; SET LOCAL ROLE anon;
--   SELECT public.enqueue_email('transactional_emails','{"probe":true}'::jsonb);  → 成功（msg id 2）
--   SELECT public.read_email_batch('transactional_emails', 10, 30);               → 成功
--   SELECT public.email_queue_dispatch();                                          → 成功
--   ROLLBACK;
--
-- ## 何が危ないか
--
-- anon キーはアプリに埋め込まれている（＝公開情報）。メール配送を有効化した瞬間に、
-- ログイン不要で次ができるようになる:
--   1. 認証済みの送信ドメイン（notify.kyoto-salute.com）から
--      **任意の宛先・件名・本文**のメールを送る（送信レピュテーションを焼かれる）
--   2. キューに入っている**体験申込者の氏名・メールアドレス・本文を読む**
--   3. 配送前の確認メールを**削除する**（お客様に届かない）
--
-- ⚠️ **ジムボード本体はメール配送が実際に動いている。** 発見元のフォークは vault が空で
-- 1通も配送されていない状態だったが、こちらは稼働中なので、上の3つは
-- **今この瞬間に成立しうる**。適用後に本番の proacl を確認し、anon を演じて
-- 実際に拒否されることまで見ること（has_function_privilege だけでは足りない）。
--
-- ## なぜ起きたか（2026-08-06 と同じ形）
--
-- 元の 20260612061340_email_infra.sql は
--   REVOKE EXECUTE ON FUNCTION public.enqueue_email(TEXT, JSONB) FROM PUBLIC;
-- と **PUBLIC からしか REVOKE していない。** ところがこのスキーマには
-- 関数オブジェクトに対して `anon` / `authenticated` へ EXECUTE を自動付与する
-- default ACL がある（Supabase の初期設定。マイグレーション履歴には出てこない）。
-- PostgreSQL の ACL は「PUBLIC への付与」と「ロールへの直接付与」の**和集合**なので、
-- PUBLIC だけ剥がしても直接付与のぶんが残る。
-- 実際の本番 proacl は `=X/postgres | anon=X/postgres | authenticated=X/postgres | ...` で、
-- **PUBLIC の付与すら復活していた**（DROP を伴う再作成で既定値に戻ったため）。
--
-- さらに `email_queue_wake` / `email_queue_dispatch` の2つは**マイグレーションに存在しない**
-- （Lovable が Management API で作ったもの。CLAUDE.md「DB の中の ref」参照）。
-- ファイルを検査するテストでは永久に見つからない。
--
-- ## 直し方
--
-- PUBLIC・anon・authenticated の3つから明示的に剥がし、service_role にだけ与える。
-- 3つ全部書くこと。どれか1つでも欠けると和集合で通ってしまう。

DO $$
DECLARE
  fn text;
  sig text;
  fns text[] := ARRAY[
    'public.enqueue_email(text, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.delete_email(text, bigint)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.email_queue_wake()',
    'public.email_queue_dispatch()'
  ];
BEGIN
  FOREACH sig IN ARRAY fns
  LOOP
    -- 関数が無い環境（メール基盤未適用・Lovable 製の2本が無い等）でも
    -- マイグレーション全体を落とさない。**ただし握りつぶさず NOTICE は出す**
    -- （20260612061340 がキュー作成を EXCEPTION WHEN OTHERS THEN NULL で
    --   握りつぶして「成功したのに入っていない」を作った前例がある）。
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skipped (not present in this database): %', sig;
    END;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.enqueue_email(text, jsonb) IS
  'メールキューへの投入。service_role 専用。anon/authenticated に EXECUTE を戻さないこと（未ログインで認証済みドメインから任意のメールを送れるようになる）。';
