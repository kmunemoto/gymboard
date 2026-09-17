-- counseling_responses を会員アカウント（auth.users）に紐付けられるようにする。
-- 背景: 体験申込時のカウンセリング回答（既往歴・注意部位）は会員登録前に作られるため、
--   その後アカウントが作られてもカルテ画面から辿れなかった。トレーナーが手動で
--   紐付けられるようにし、カルテ側で禁忌事項として表示できるようにする（CLIENT_PRECAUTIONS_ENABLED）。
-- 紐付けは既定 NULL・トレーナーが手動で設定する運用のため、既存RLS
-- （テナント一致 + trainerロールのみ閲覧/更新可）はそのまま変更しない。
ALTER TABLE public.counseling_responses
  ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_counseling_responses_user_id ON public.counseling_responses(user_id);
