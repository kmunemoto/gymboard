-- 新着メッセージのプッシュ通知を、送信者の端末からサーバー側へ移す（2026-08-11）
--
-- ## なぜ
--
-- 通知は `src/hooks/useMessages.ts` の sendMessage の中で fire-and-forget していた。
-- つまり**送信者の端末が投げていた**ので、送信直後にアプリを閉じる・画面を切り替える・
-- 電波が切れる、のどれでも**通知が飛ばない**。失敗しても console に出るだけで、
-- 送った本人にも受け取る側にも分からない。
--
-- 「送れたように見えて相手に届いていない」型。messages の INSERT を起点にする。
--
-- ## 落ちても絶対にメッセージを失わない
--
-- 通知は「あったほうがいいもの」で、メッセージ本体は「絶対に落としてはいけないもの」。
-- この関数は EXCEPTION で全部握りつぶして RETURN NEW する。**通知の失敗が INSERT を
-- 巻き添えにすることは無い。** vault の設定が無い場合も同じ（ログだけ出して素通り）。
--
-- ## 🔴 project ref を焼き込まない
--
-- 呼び先の URL を `https://<ref>.supabase.co/...` と直書きすると、**兄弟アプリが
-- このマイグレーションをコピーした瞬間、そのジムの通知がジムボードのプロジェクトに
-- 飛ぶ。** 実際に `email_queue_*` でそれが起きている（CLAUDE.md 参照）。
-- URL も鍵も vault から読む。
--
-- ## 適用後にやること（vault に2つ入れる。値はリポジトリに書かない）
--
--   select vault.create_secret('https://<自分のref>.supabase.co/functions/v1',
--                              'project_functions_url');
--   -- service_role キーは既存の 'email_queue_service_role_key' があればそれを使う。
--   -- 無ければ 'service_role_key' という名前で入れる（こちらが優先される）。
--
-- どちらか欠けていると通知は飛ばないが、**メッセージの送受信は普通に動く**。

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key  text;
  v_base text;
BEGIN
  SELECT decrypted_secret INTO v_base
    FROM vault.decrypted_secrets
   WHERE name = 'project_functions_url'
   LIMIT 1;

  -- 専用の名前があればそれを、無ければメールキューが使っている既存の鍵を借りる。
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name IN ('service_role_key', 'email_queue_service_role_key')
   ORDER BY CASE name WHEN 'service_role_key' THEN 0 ELSE 1 END
   LIMIT 1;

  IF v_base IS NULL OR v_key IS NULL THEN
    RAISE LOG 'notify_new_message: vault secret missing (project_functions_url / service_role_key). skipped message %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_base || '/notify-new-message',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    -- 🔴 本文やタイトルは渡さない。message_id だけ渡し、Edge Function が
    --    service_role で実物を読み直す。実在する行の内容しか通知に載らない。
    body    := jsonb_build_object('message_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'notify_new_message failed for message %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_message_insert_notify ON public.messages;
CREATE TRIGGER on_message_insert_notify
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();

COMMENT ON FUNCTION public.notify_new_message() IS
  '新着メッセージのプッシュ通知を notify-new-message Edge Function に投げる。'
  '通知の失敗は握りつぶす（メッセージの INSERT を絶対に妨げない）。'
  'URL と鍵は vault（project_functions_url / service_role_key）から読む。';
