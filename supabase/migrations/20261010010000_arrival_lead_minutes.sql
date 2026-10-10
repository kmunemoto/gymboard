-- ============================================================================
-- 「ご来店は 13:55 以降にお願いします」を、お客様の予約完了画面などに出せるようにする
--
-- 2026-10-10 宗本さん:
--   「予約を受けた時にお客様にセッション開始の5分前以内にお越しください。
--    のメッセージを伝えたい。10分前とかに来られると困るから」
--
-- `arrival_lead_minutes` に「開始の何分前から来てよいか」を入れたジムだけ、
-- 予約完了の画面・ホームの「次回の予約」・体験予約の完了画面に
-- 「ご来店は {開始時刻 − 分} 以降にお願いします」を出す（src/lib/arrivalGuide.ts）。
-- **NULL（既定）は今まで通り**＝設定していないジムの見え方は変わらない。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public。値の設定は本番で直接行う）。
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS arrival_lead_minutes integer;

-- 1〜60 分だけ受ける（0 や負の数・何時間も前は設定ミス）。範囲は src/lib/arrivalGuide.ts と同じ
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_arrival_lead_minutes_range;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_arrival_lead_minutes_range
  CHECK (arrival_lead_minutes IS NULL OR (arrival_lead_minutes BETWEEN 1 AND 60));

COMMENT ON COLUMN public.tenants.arrival_lead_minutes IS
  'お客様に案内する「開始の何分前から来てよいか」（分）。例 5 なら 14:00 開始に「13:55 以降にお願いします」。NULL は案内を出さない';

-- ── 公開ページ（体験予約）へ届ける ─────────────────────────────────────────
-- 体験予約ページはログイン不要なので tenants を直接読めない。
-- 返り値の型を変えるので DROP → CREATE → GRANT の3点セット（既存の前例どおり）。
-- ⚠️ DROP すると GRANT も消える。必ず貼り直すこと。
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);

CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
 RETURNS TABLE(
   id uuid, gym_name text, gym_name_short text, address text, logo_url text,
   primary_color text, trial_info_title text, trial_info_body text,
   booking_buffer_minutes integer, slot_duration_minutes integer,
   booking_capacity integer, booking_cutoff_type text, booking_cutoff_hours integer,
   trial_price_yen integer, operating_hours jsonb, booking_window_days integer,
   trial_ignores_blocked_slots boolean, public_theme_color text,
   arrival_lead_minutes integer
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours,
         t.trial_price_yen, t.operating_hours, t.booking_window_days,
         t.trial_ignores_blocked_slots, t.public_theme_color, t.arrival_lead_minutes
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated, service_role;
