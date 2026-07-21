-- トレーナー向け「今日の予定」朝のサマリー通知（ジムごとにON/OFF可能）。
-- 既定はON（お客様向けリマインダーと同様、通知が来ること自体は有益で低頻度=1日1回のため
-- opt-out方式。show_retention_alerts と同じ既定ONの方針）。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS daily_summary_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tenants.daily_summary_enabled IS
  '毎朝、その日の予約一覧をオーナー/トレーナーへプッシュ通知するか（既定true）。';
