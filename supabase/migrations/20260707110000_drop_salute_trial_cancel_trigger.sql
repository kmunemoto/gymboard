-- Salute 連携の停止（体験予約サイトを GymBoard 専用に移行済みのため）。
--
-- これまで trial_bookings のキャンセル/削除時に propagate_trial_cancellation() が
-- 旧 Salute 予約システムへ逆同期（sync-trial-cancel-to-salute）を発火していたが、
-- Salute はもう使わないため不要。トリガーと関数を削除する。
--
-- 参考: 20260625054831 で作成したトリガー・関数を元に戻す。
-- （Salute への他の経路: 1時間ごとの pg_cron バッチ sync-bookings-to-salute /
--   reconcile-bookings-from-salute は cron 側で unschedule する。ここでは扱わない）

DROP TRIGGER IF EXISTS trial_cancellation_to_salute ON public.trial_bookings;
DROP FUNCTION IF EXISTS public.propagate_trial_cancellation();
