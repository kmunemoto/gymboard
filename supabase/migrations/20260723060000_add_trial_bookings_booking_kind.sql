ALTER TABLE public.trial_bookings
  ADD COLUMN IF NOT EXISTS booking_kind TEXT NOT NULL DEFAULT 'trial';

COMMENT ON COLUMN public.trial_bookings.booking_kind IS
  '予約種別。trial=無料体験(既定・/trial 経由)、drop_in=単発ドロップイン(¥8,000・現地決済・観光客向け・/drop-in 経由)。send-trial-reminders 等の絞り込みに使用。';
