-- 利用期間（残り回数・期限）のリマインド通知のON/OFF。
-- 期限が近く残り回数があるお客様へ、期限7日前・3日前にプッシュで案内する。
-- 既存レコードは true 既定（後方互換: 未設定=受け取る）。

ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS reminder_period boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_preferences.reminder_period IS
  '利用期間リマインド（期限が近く残り回数がある場合に期限7日前・3日前に通知）を受け取るか。既定 true。';
