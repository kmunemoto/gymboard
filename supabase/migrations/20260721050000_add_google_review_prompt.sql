-- 口コミ依頼の自動化。来店が一定回数に達したお客様へ、アプリ内で控えめにGoogle口コミを
-- 依頼するバナーを一度だけ表示する。
-- ジムがURLを入力するだけで有効になる（line_url/website_url等と同じ、専用ON/OFFは設けない）。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS google_review_url text;
COMMENT ON COLUMN public.tenants.google_review_url IS
  'Googleの口コミ投稿ページURL。null/空なら口コミ依頼バナーは表示しない。';

-- お客様ごとに一度表示（またはスキップ）したら二度と出さないためのフラグ。
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS review_prompted_at timestamptz;
COMMENT ON COLUMN public.profiles.review_prompted_at IS
  '口コミ依頼バナーを表示済み（クリック・スキップいずれも）の日時。nullなら未表示。';
