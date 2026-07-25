-- LINE前日リマインドの定期実行を止める。
--
-- LINE（Messaging API）連携はマルチテナント化に伴い無効化した
-- （src/lib/featureFlags.ts の LINE_INTEGRATION_ENABLED = false）。
-- ただしクライアント側のフラグはブラウザの送信しか止めない。
-- 前日リマインドは pg_cron から line-booking-reminder を叩くサーバー側の処理なので、
-- ジョブ自体を止めないと送信が続く。
--
-- なぜLINEを止めるか:
--   LINE_CHANNEL_ACCESS_TOKEN が全テナント共有の1本しか無く、ジムごとに
--   公式アカウントを持たせる仕組みが無い。そのため line-booking-reminder は
--   事故防止のため特定テナントに限定されており、他ジムには前日リマインドが
--   一切届かない状態だった（あるのに動かない機能）。
--
-- ジョブ名がリポジトリ側で管理されていない（Supabase 上で直接作成された）ため、
-- コマンド本文に line-booking-reminder を含むジョブを名前に依存せず探して止める。
-- 冪等: 対象が無ければ何もしない。pg_cron が入っていない環境でも失敗しない。
--
-- 元に戻すには: LINE_INTEGRATION_ENABLED を true にしたうえで、
-- cron.schedule(...) でジョブを作り直す。ただし本来は、ジムごとに
-- チャネルアクセストークンを持てるようにしてからにすること。

DO $$
DECLARE
  j record;
  removed int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron が無いためスキップします';
    RETURN;
  END IF;

  FOR j IN
    SELECT jobid, jobname FROM cron.job WHERE command ILIKE '%line-booking-reminder%'
  LOOP
    PERFORM cron.unschedule(j.jobid);
    removed := removed + 1;
    RAISE NOTICE 'cronジョブを停止しました: % (jobid=%)', j.jobname, j.jobid;
  END LOOP;

  IF removed = 0 THEN
    RAISE NOTICE 'line-booking-reminder のcronジョブは見つかりませんでした（既に停止済み）';
  END IF;
END $$;
