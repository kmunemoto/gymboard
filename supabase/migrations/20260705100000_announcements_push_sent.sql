-- お知らせのプッシュ通知送信管理。
-- 公開時（published_at 到来時）に一度だけプッシュ通知を送るための送信済みマーカー。
-- push-announcements エッジ関数が「published_at <= now かつ push_sent_at IS NULL」を
-- 原子的にクレーム（UPDATE ... WHERE push_sent_at IS NULL）してから送信する。

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;

COMMENT ON COLUMN public.announcements.push_sent_at IS
  'お知らせのプッシュ通知を送信した日時。NULL=未送信。公開済みになると push-announcements が送信してマークする。';

-- 既存のお知らせは送信済み扱いにする（導入時に過去のお知らせへ一斉送信されるのを防ぐ）
UPDATE public.announcements
  SET push_sent_at = published_at
  WHERE push_sent_at IS NULL AND published_at <= now();
