-- トレーナーダッシュボード上部の4つの統計カード（本日のセッション/アクティブ顧客/
-- 月間セッション/今月売上）を、ジムごとに個別に表示/非表示できるようにする。
-- 既定は全てtrue（既存の表示のまま）。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS show_stat_today_sessions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_stat_active_clients boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_stat_month_sessions boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_stat_month_revenue boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.show_stat_today_sessions IS 'ダッシュボードに「本日のセッション」カードを表示するか（既定true）。';
COMMENT ON COLUMN public.tenants.show_stat_active_clients IS 'ダッシュボードに「アクティブ顧客」カードを表示するか（既定true）。';
COMMENT ON COLUMN public.tenants.show_stat_month_sessions IS 'ダッシュボードに「月間セッション」カードを表示するか（既定true）。';
COMMENT ON COLUMN public.tenants.show_stat_month_revenue IS 'ダッシュボードに「今月売上」カードを表示するか（既定true）。';
