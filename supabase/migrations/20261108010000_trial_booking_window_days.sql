-- ============================================================================
-- 体験予約だけの「何日先まで受け付けるか」（tenants.trial_booking_window_days・ジムごと・2026-11-08）
-- ============================================================================
-- 宗本さん（2026-11-08）: 「体験の受付を2週間先までに延ばしたい」
--
-- ■ 何が足りなかったか
-- 「何日先まで」は tenants.booking_window_days の1つだけで、会員の予約と公開ページ（体験・ドロップイン）が
-- 共通で使っていた（未設定なら会員は1ヶ月先・公開ページは10日先。src/lib/bookingWindow.ts）。
-- 体験だけを14日にしたくても、booking_window_days を14にすると**会員まで2週間に縮む**。
--
-- ■ 直し方
-- 1. tenants.trial_booking_window_days（NULL＝今まで通り）。体験予約（メニューの体験を含む）だけに効く。
--    決め方: 体験だけの設定 → booking_window_days → 従来の10日（src/lib/bookingWindow.ts の trialBookingWindowDays・
--    supabase/functions/_shared/trialRules.ts の trialWindowDays。両方が同じ答えを返す）。
--    会員の予約・ドロップインは今まで通り booking_window_days を見る。
-- 2. 体験予約ページはログイン不要で tenants を直接読めないので、get_tenant_public から返す。
--    返り値の型を変えるので DROP → CREATE → GRANT の3点セット（20261027010000_pre_visit_note.sql と同じ）。
--    ⚠️ DROP すると GRANT も消える。必ず貼り直すこと（忘れると体験予約ページが全店で開けない）。
--    列の並びは本番の定義（2026-11-08 の pg_get_functiondef・md5 61210550c9249affc1acf998f03569bb）の末尾に足しただけ。
--
-- 特定のジムの値はここに書かない（公開リポジトリ。値は本番で個別に入れる）。
-- 見張り: src/test/trialBookingWindow.test.tsx
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_booking_window_days integer;

-- 範囲は src/lib/bookingWindow.ts の BOOKING_WINDOW_MIN_DAYS / MAX_DAYS と同じ（booking_window_days と同じ範囲）
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_trial_booking_window_days_range;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_trial_booking_window_days_range
  CHECK (trial_booking_window_days IS NULL OR trial_booking_window_days BETWEEN 1 AND 365);

COMMENT ON COLUMN public.tenants.trial_booking_window_days IS
  '体験予約（公開ページ・メニューの体験）を何日先まで受け付けるか。NULL は booking_window_days と同じ（それも NULL なら10日）。会員の予約には効かない。src/lib/bookingWindow.ts';

-- ── 公開ページ（体験予約）へ届ける ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);

CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
 RETURNS TABLE(
   id uuid, gym_name text, gym_name_short text, address text, logo_url text,
   primary_color text, trial_info_title text, trial_info_body text,
   booking_buffer_minutes integer, slot_duration_minutes integer,
   booking_capacity integer, booking_cutoff_type text, booking_cutoff_hours integer,
   trial_price_yen integer, operating_hours jsonb, booking_window_days integer,
   trial_ignores_blocked_slots boolean, public_theme_color text,
   arrival_lead_minutes integer, pre_visit_note text, trial_booking_window_days integer
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours,
         t.trial_price_yen, t.operating_hours, t.booking_window_days,
         t.trial_ignores_blocked_slots, t.public_theme_color, t.arrival_lead_minutes,
         t.pre_visit_note, t.trial_booking_window_days
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated, service_role;
