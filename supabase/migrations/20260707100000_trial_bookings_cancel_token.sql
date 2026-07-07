-- 体験予約のお客様セルフキャンセル用トークン。
-- 体験予約はアカウント無しのゲストが作成するため、キャンセルを認可する「秘密の合言葉」を
-- 予約1件ごとに持たせる。この推測困難なトークンを知っている＝本人、として trial-cancel
-- エッジ関数がキャンセルを許可する（メールでジムへ連絡する従来フローを置き換える）。
--
-- NOT NULL DEFAULT gen_random_uuid() により既存行にも一意なトークンが自動で埋まる。

ALTER TABLE public.trial_bookings
  ADD COLUMN IF NOT EXISTS cancel_token uuid NOT NULL DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.trial_bookings.cancel_token IS
  'お客様セルフキャンセル用の秘密トークン。確認メール／予約完了画面のキャンセルリンクに埋め込み、trial-cancel エッジ関数が本人確認代わりに使う。';

-- トークンでの単一行検索 (trial-cancel の .eq("cancel_token", ...)) を高速化し、一意性を保証する。
CREATE UNIQUE INDEX IF NOT EXISTS trial_bookings_cancel_token_key
  ON public.trial_bookings (cancel_token);
