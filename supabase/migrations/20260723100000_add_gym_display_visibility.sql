-- ジム側（トレーナー画面）の各表示要素を、ジムごとにON/OFFできるようにする。
-- 既存の show_retention_alerts / show_stat_* と同じ方針:
--   boolean NOT NULL DEFAULT true（＝適用直後は従来どおり全部表示）。
--
-- 1) ホーム画面（ダッシュボード）の各セクション
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS show_today_schedule       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_trial_followup_alert BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_renewal_alerts       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_counseling_responses BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_revenue_chart        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_utilization_heatmap  BOOLEAN NOT NULL DEFAULT true;

-- 2) メニュー（サイドバー / モバイル下部ナビ）の各タブ
--    ホーム・顧客・予約・設定は、隠すとジム自身が操作不能になり得るため対象外
--    （特に設定を隠すと、この画面自体に戻れず設定を戻せなくなる）。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS show_nav_messages        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_nav_exercises       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_nav_counseling      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_nav_announcements   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_nav_notifications   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_nav_trial_followups BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.show_today_schedule       IS 'ホーム画面に「本日のセッション」を表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_trial_followup_alert IS 'ホーム画面に「体験フォロー待ち」バナーを表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_renewal_alerts       IS 'ホーム画面に「更新が近い顧客」を表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_counseling_responses IS 'ホーム画面に「カウンセリング回答」を表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_revenue_chart        IS 'ホーム画面に「売上推移」グラフを表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_utilization_heatmap  IS 'ホーム画面に「稼働率ヒートマップ」を表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_nav_messages         IS 'メニューに「メッセージ」を表示するか。既定true（非表示でも機能自体は残る）';
COMMENT ON COLUMN public.tenants.show_nav_exercises        IS 'メニューに「種目」を表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_nav_counseling       IS 'メニューに「カウンセリング」を表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_nav_announcements    IS 'メニューに「お知らせ」を表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_nav_notifications    IS 'メニューに「通知」を表示するか。既定true';
COMMENT ON COLUMN public.tenants.show_nav_trial_followups  IS 'メニューに「体験フォロー」を表示するか。既定true';
