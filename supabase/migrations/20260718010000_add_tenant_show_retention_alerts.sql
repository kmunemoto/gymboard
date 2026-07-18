-- トレーナーのホーム画面に「フォローが必要な顧客」（離脱検知）セクションを表示するか。
-- 既定 true＝表示（現状維持）。ジムごとにオン/オフできる。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS show_retention_alerts BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.show_retention_alerts IS
  'トレーナーのホーム画面に「フォローが必要な顧客」（離脱検知）セクションを表示するか。既定true=表示。';
