ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS milestone_goal text,
  ADD COLUMN IF NOT EXISTS milestone_goal_set_at timestamptz;

COMMENT ON COLUMN public.profiles.milestone_goal IS
  '3ヶ月ごとの中目標(棚卸し面談で設定)。null=未設定・未導入のお客様。';
COMMENT ON COLUMN public.profiles.milestone_goal_set_at IS
  '中目標を最後に設定・更新した日時。90日経過で次回棚卸しの目安。';
