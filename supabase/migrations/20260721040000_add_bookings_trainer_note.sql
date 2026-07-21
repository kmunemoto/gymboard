-- セッションメモ（カルテ）。トレーナーが予約1件ごとに自由記入できるメモ。
-- 「今日は膝の調子が悪そうだった」「次回は◯◯を提案する」など、接客の引き継ぎに使う。
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS trainer_note text;

COMMENT ON COLUMN public.bookings.trainer_note IS
  'トレーナーが記入する、その予約回についての自由記入メモ（任意）。';
