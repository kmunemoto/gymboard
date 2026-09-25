-- ============================================================================
-- 公開の予約ページ（体験・ドロップイン）の色を、ジムごとに固定できるようにする
--
-- 2026-09-25 宗本さん:
--   「私のジムの体験予約ページの色はオレンジ変えてティファニーブルーに固定して」
--
-- 公開ページは独自の色を持たず、見ている端末の「テーマカラー」（設定画面で選ぶ・
-- localStorage）で描かれる。初めて来るお客様は既定（ティファニー系）で見るが、
-- テーマカラーを変えたスタッフや会員の端末では、その色（オレンジ等）で見える。
--
-- `public_theme_color` にテーマカラーの id（例 'teal-soft'）を入れたジムだけ、
-- 公開ページをその色に固定する（src/hooks/usePublicPageTheme.ts）。
-- **NULL（既定）は今まで通り**＝設定していないジムの見え方は変わらない。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public。値の設定は本番で直接行う）。
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS public_theme_color text;

-- テーマカラーの id の形（'色-トーン'）だけ受ける。知らない色は画面側で無視する（今まで通りに倒れる）
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_public_theme_color_format;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_public_theme_color_format
  CHECK (public_theme_color IS NULL OR public_theme_color ~ '^[a-z]+-(vivid|soft|dusty|deep)$');

COMMENT ON COLUMN public.tenants.public_theme_color IS
  '公開の予約ページ（体験・ドロップイン）の色。テーマカラーの id（例 teal-soft）。NULL は見ている端末のテーマカラーのまま';

-- ── 公開ページへ届ける ─────────────────────────────────────────────────────
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
   trial_ignores_blocked_slots boolean, public_theme_color text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours,
         t.trial_price_yen, t.operating_hours, t.booking_window_days,
         t.trial_ignores_blocked_slots, t.public_theme_color
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated, service_role;
