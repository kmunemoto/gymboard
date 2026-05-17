
-- Add cycle_start_date column to profiles
ALTER TABLE public.profiles
ADD COLUMN cycle_start_date date;

-- Backfill: set cycle_start_date to the earliest non-cancelled booking date for each user
UPDATE public.profiles p
SET cycle_start_date = sub.earliest_date
FROM (
  SELECT user_id, MIN(booking_date::date) AS earliest_date
  FROM public.bookings
  WHERE status != 'キャンセル済み'
  GROUP BY user_id
) sub
WHERE p.user_id = sub.user_id
  AND p.cycle_start_date IS NULL;
