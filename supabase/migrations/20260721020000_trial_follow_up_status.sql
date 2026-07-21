-- 体験予約のフォローアップ管理（体験CRM）。
-- 体験予約は今まで「予約が入る→当日を迎える」で終わりで、その後「来店したか／
-- 入会したか／見送りか」を記録する場所が無かった。trial_bookings に状態列を追加し、
-- トレーナーが体験後にステータスを更新できるようにする。
-- status（予約自体の状態: 予約済み/キャンセル済み）とは独立した別の軸のため、
-- 既存の status 列とは別カラムにする（bookings.status のように上書きしない）。

ALTER TABLE public.trial_bookings
  ADD COLUMN IF NOT EXISTS follow_up_status text NOT NULL DEFAULT '未対応',
  ADD COLUMN IF NOT EXISTS follow_up_note text;

COMMENT ON COLUMN public.trial_bookings.follow_up_status IS
  '体験後のフォロー状況。想定値: 未対応/来店した/入会した/見送り（CHECK制約なし、bookings.statusと同じ方針）。';
COMMENT ON COLUMN public.trial_bookings.follow_up_note IS
  'トレーナーが自由記入するフォローメモ（任意）。';
