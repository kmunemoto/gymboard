-- 体験CRM の強化（2026-08-26）
--
-- ## 本番を見て分かったこと
--
-- 体験予約は70件（2026-06-15〜）あるが、**フォロー状況が1件も記録されていない**
-- （全70件が「未対応」・メモ0件）。うち実データは約26件で、残りはオーナーのテスト予約。
--
-- そして **`send-trial-reminders` に cron が登録されていない**。
-- 関数はデプロイ済みなのに一度も動いておらず、体験のお客様には前日リマインドが
-- **一度も届いていない**。実データ26件のうち16件がキャンセルになっている。
--
-- ## やること
--
-- 1. 🔴 体験リマインドの定期実行を登録する（届いていないものを届くようにする）
-- 2. フォロー状況を日本語の自由文字列からコードにする
-- 3. フォロー日・流入元・見送り理由を持てるようにする

-- ---------------------------------------------------------------------------
-- 1. 🔴 体験リマインドの定期実行
-- ---------------------------------------------------------------------------

-- 会員向けの前日リマインド（push-booking-reminder-daily）と同じ 21:00 JST。
-- 10分ずらしてあるのは、同時刻に2つのバッチが走るとログが読みにくいため。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron が無いためスキップします';
    RETURN;
  END IF;

  -- 冪等: 既にあれば作り直さない（スケジュールを手で変えていたら尊重する）
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-trial-reminders-daily') THEN
    RAISE NOTICE 'send-trial-reminders-daily は既に登録済みです';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'send-trial-reminders-daily',
    '10 12 * * *',
    $cron$
    SELECT net.http_post(
      -- 🔴 project ref を焼き込まない。焼き込むと、兄弟アプリがこの migration を
      --    コピーした瞬間、そのジムの通知が**ジムボードのプロジェクト**へ飛ぶ
      --    （見張り: src/test/messageNotification.test.ts）
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets
               WHERE name = 'project_functions_url' LIMIT 1) || '/send-trial-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
  RAISE NOTICE 'send-trial-reminders-daily を登録しました';
END $$;

-- ---------------------------------------------------------------------------
-- 2. フォロー状況のコード化
-- ---------------------------------------------------------------------------

-- これまで DB には日本語の自由文字列（未対応 / 来店した / 入会した / 見送り）が
-- 入っていた。CHECK が無いため、打ち間違いや将来の言い回しの変更で
-- 「翻訳キーが解決できず画面に生の文字列が出る」事故が起きうる。
--
-- ⚠️ **公開済みのネイティブアプリは日本語を書いてくる。** 端末に配ったものは
--    書き換えられないので、CHECK をコードだけにすると古いアプリからの保存が失敗する。
--    そこで**入口で翻訳するトリガー**を置く。古いアプリは今までどおり動き、
--    DB には常にコードだけが入る。

UPDATE public.trial_bookings
   SET follow_up_status = CASE follow_up_status
     WHEN '未対応'   THEN 'pending'
     WHEN '来店した' THEN 'visited'
     WHEN '入会した' THEN 'joined'
     WHEN '見送り'   THEN 'declined'
     ELSE follow_up_status
   END
 WHERE follow_up_status IN ('未対応', '来店した', '入会した', '見送り');

ALTER TABLE public.trial_bookings
  ALTER COLUMN follow_up_status SET DEFAULT 'pending';

-- 入口の翻訳。古いクライアントが日本語を送ってきても、ここでコードに直してから入る。
CREATE OR REPLACE FUNCTION public.normalize_trial_follow_up_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.follow_up_status := CASE NEW.follow_up_status
    WHEN '未対応'   THEN 'pending'
    WHEN '来店した' THEN 'visited'
    WHEN '入会した' THEN 'joined'
    WHEN '見送り'   THEN 'declined'
    ELSE NEW.follow_up_status
  END;
  -- 想定外の値（打ち間違い・将来の追加）は既定に倒す。
  -- 🔴 ここで例外を投げない。保存が落ちると、店は原因の分からないエラーを見る
  IF NEW.follow_up_status IS NULL
     OR NEW.follow_up_status NOT IN ('pending', 'visited', 'joined', 'declined') THEN
    NEW.follow_up_status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_trial_follow_up_status ON public.trial_bookings;
CREATE TRIGGER trg_normalize_trial_follow_up_status
  BEFORE INSERT OR UPDATE OF follow_up_status ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.normalize_trial_follow_up_status();

-- トリガーが必ず正すので、CHECK はコードだけでよい（二重の守り）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trial_bookings_follow_up_status_check'
  ) THEN
    ALTER TABLE public.trial_bookings
      ADD CONSTRAINT trial_bookings_follow_up_status_check
      CHECK (follow_up_status IN ('pending', 'visited', 'joined', 'declined'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. 追えるようにする列
-- ---------------------------------------------------------------------------

ALTER TABLE public.trial_bookings
  ADD COLUMN IF NOT EXISTS followed_up_at  timestamptz,
  ADD COLUMN IF NOT EXISTS source          text,
  ADD COLUMN IF NOT EXISTS declined_reason text;

COMMENT ON COLUMN public.trial_bookings.followed_up_at IS
  '店がフォローした時刻。状態を「未対応」以外にしたときに入る。空欄なら未対応のまま。';
COMMENT ON COLUMN public.trial_bookings.source IS
  '流入元（どこで知ったか）。自由入力。集計は文字列一致なので表記ゆれはそのまま出る。';
COMMENT ON COLUMN public.trial_bookings.declined_reason IS
  '見送りの理由。状態が declined のときだけ意味を持つ。';

-- 自由入力なので上限を切る（他の自由入力列と同じ作法）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trial_bookings_source_len') THEN
    ALTER TABLE public.trial_bookings
      ADD CONSTRAINT trial_bookings_source_len
      CHECK (source IS NULL OR char_length(source) <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trial_bookings_declined_reason_len') THEN
    ALTER TABLE public.trial_bookings
      ADD CONSTRAINT trial_bookings_declined_reason_len
      CHECK (declined_reason IS NULL OR char_length(declined_reason) <= 500);
  END IF;
END $$;

-- ダッシュボードの「フォロー待ち件数」と一覧の並びで使う
CREATE INDEX IF NOT EXISTS trial_bookings_tenant_followup_idx
  ON public.trial_bookings (tenant_id, follow_up_status, booking_date DESC);
