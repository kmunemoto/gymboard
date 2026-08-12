-- 新着メッセージ通知の認可を x-cron-secret に直す（2026-08-12）
--
-- ## 何が起きていたか
--
-- 20260811010000 で入れた notify_new_message() は、Edge Function を
--
--     Authorization: Bearer <vault の service_role キー>
--
-- で叩いていた。**本番で 403 Forbidden が返り、通知が1件も飛ばなかった。**
-- しかもトリガーは EXCEPTION を握りつぶす作りなので、**メッセージの INSERT は成功し、
-- どこにもエラーが出ない**。「送れたように見えて相手に届いていない」型そのもの。
--
-- ## なぜ 403 なのか
--
-- supabase/functions/_shared/auth.ts の verifyCaller は
--
--     token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
--
-- と**文字列の完全一致**で判定する。vault の email_queue_service_role_key は
-- 確かにこのプロジェクト（ref 一致・role=service_role・2036年まで有効）の
-- 正規のキーだが、**Edge Function ランタイムの環境変数と同じ文字列とは限らない**。
-- 「有効なキーである」ことと「その環境変数と一致する」ことは別。
--
-- ## なぜ x-cron-secret なのか
--
-- このプロジェクトで pg_net から Edge Function を叩いている既存の4つ
-- （push-announcements / push-booking-reminder-daily / -hourly / push-period-reminder）は
-- **全部 x-cron-secret を使っていて、service_role キーを使っているものは1つも無い。**
-- Bearer 経路はこのプロジェクトで一度も通ったことがなかった。
--
-- 実測（2026-08-12、本番）:
--   Authorization: Bearer <service_role>  → 403 {"error":"Forbidden"}
--   x-cron-secret: <vault の cron_secret> → 200 {"sent":1,"message_id":"..."}
--
-- セキュリティ上もこちらが良い。**DBのトリガーに service_role キーを持たせない**
-- （漏れたときの被害が RLS 全素通りの鍵と、この関数1本の呼び出し権とでは桁が違う）。
--
-- ## 前提（vault に2つ。値はリポジトリに書かない）
--   project_functions_url … https://<自分のref>.supabase.co/functions/v1（末尾スラッシュ無し）
--   cron_secret           … Edge Function 側の CRON_SECRET と同じ文字列

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

  -- 🔴 service_role キーではなく CRON_SECRET を使う。理由は冒頭コメント。
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'cron_secret'
   LIMIT 1;

  IF v_base IS NULL OR v_key IS NULL THEN
    RAISE LOG 'notify_new_message: vault secret missing (project_functions_url / cron_secret). skipped message %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_base || '/notify-new-message',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', v_key
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

COMMENT ON FUNCTION public.notify_new_message() IS
  '新着メッセージのプッシュ通知を notify-new-message Edge Function に投げる。'
  '通知の失敗は握りつぶす（メッセージの INSERT を絶対に妨げない）。'
  'URL と鍵は vault（project_functions_url / cron_secret）から読む。'
  'service_role キーは使わない（verifyCaller は環境変数との完全一致で判定するため）。';
