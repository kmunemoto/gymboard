-- ジムの LINE 連絡先 URL。お客様アプリの「LINEで連絡」ボタンのリンク先。
-- 空/NULL のジムではボタンを表示しない（既定は NULL＝現状維持）。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS line_url TEXT;

COMMENT ON COLUMN public.tenants.line_url IS
  'ジムのLINE連絡先URL（例: https://line.me/R/ti/p/@xxxx や https://lin.ee/xxxx）。お客様アプリの「LINEで連絡」ボタンのリンク先。NULL/空ならボタン非表示。';
