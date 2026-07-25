-- Salute御所南の「2026年6月ロック」を撤去する。
--
-- 経緯: 2026年6月は旧Saluteアプリで予約を管理し、7月からGymBoardへ移行するという
-- 棲み分けのため、Saluteテナントの2026年6月の予約 INSERT/DELETE をサーバー側で
-- 拒否していた（20260617102908 で追加、20260704120000 でトレーナー操作を除外）。
--
-- 撤去する理由:
--   - 対象期間（2026年6月）は既に過去で、この先発火することがない。
--   - 旧Saluteアプリは廃止済みで、棲み分けの前提そのものが無くなった。
--   - 特定テナント専用のルールが共有テーブルのトリガーに残っていると、
--     他ジムに提供するうえで挙動の説明がつかない（マルチテナント化の妨げ）。
DROP TRIGGER IF EXISTS guard_salute_june_2026_bookings_ins ON public.bookings;
DROP TRIGGER IF EXISTS guard_salute_june_2026_bookings_del ON public.bookings;
DROP FUNCTION IF EXISTS public.guard_salute_june_2026_bookings();
