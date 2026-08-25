-- 取り込んだ顧客への招待（2026-08-25）
--
-- CSV 一括登録（20260825010000）で作った顧客は、ログイン手段の無いアカウントとして
-- 店の中にだけ存在する。店が「招待する」を押した時刻をここに記録する。
--
-- 招待の実体は Edge Function（invite-customers ではなく invite-customer）:
--   1. アカウントのメールを本人のアドレスに差し替える（店が入力する）
--   2. パスワード設定リンク（recovery）を生成して招待メールを送る
--   3. 送信に成功したらこの列を埋める
--
-- 状態は3段階になる:
--   imported_at のみ            … 未招待（お客様には何も届いていない）
--   imported_at + invited_at    … 招待済み・未ログイン（メールは送った）
--   imported_at + claimed_at    … 本人がログイン済み（バッジは消える）

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

COMMENT ON COLUMN public.profiles.invited_at IS
  '店が招待メールを送った時刻。imported_at がある行にだけ意味を持つ。送信に成功したときだけ入る。';
