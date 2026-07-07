ALTER TABLE public.trial_bookings
  ADD COLUMN IF NOT EXISTS cancel_token uuid NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.trial_bookings.cancel_token IS
  'お客様セルフキャンセル用の秘密トークン。確認メール／予約完了画面のキャンセルリンクに埋め込み、trial-cancel エッジ関数が本人確認代わりに使う。';

CREATE UNIQUE INDEX IF NOT EXISTS trial_bookings_cancel_token_key
  ON public.trial_bookings (cancel_token);

DROP TRIGGER IF EXISTS trial_cancellation_to_salute ON public.trial_bookings;
DROP FUNCTION IF EXISTS public.propagate_trial_cancellation();