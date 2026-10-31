-- ============================================================================
-- Google カレンダーの連携のトークンを、画面（API）から読めないようにする（2026-10-31・Edge Function の点検）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- ■ 何が起きていたか（google-calendar-callback-1）
-- 連携の同意（OAuth）の state は「連携を始めた人」に結びつくだけで、ブラウザには結びついていない。
-- 攻撃者が自分の state 付きの同意リンクを他の人に踏ませると、その人の Google のトークンが
-- **攻撃者の行**に保存される。しかも本人は自分の行の全列（access_token・refresh_token）を API で読めたので、
-- 他人の Google カレンダー（同期されたお客様の氏名・予約時刻を含む）を読み書きできた。
--
-- ■ 直し方（このマイグレーション）
-- トークンの列を、画面から読めない・書けないようにする。画面が読んでいるのは「連携しているか」を見る id だけ
-- （TrainerNotificationSettings・CustomerSettings の select("id")）。連携の保存（google-calendar-callback）と
-- 使用（google-calendar-sync）は service_role なので影響しない。連携の解除（DELETE、自分の行だけ）は残す。
-- これで、同意を踏ませても攻撃者はトークンを読めない。
--
-- 残り: state をブラウザに結びつける（連携の完了をログイン中の本人が確かめる形にする）。画面の変更が要るので別に行う。
--
-- 見張り: src/test/googleCalendarSyncAuthz.test.ts
-- ============================================================================

REVOKE SELECT, INSERT, UPDATE ON public.google_calendar_tokens FROM anon, authenticated;
GRANT SELECT (id, user_id, calendar_id, expires_at, created_at, updated_at) ON public.google_calendar_tokens TO authenticated;
