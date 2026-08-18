-- ============================================================================
-- get_tenant_public に operating_hours を足す
-- ============================================================================
--
-- 公開ページ（体験予約 /trial、ドロップイン /dropin）は anon から
-- get_tenant_public 経由でしかテナントを読めない。この関数が営業時間を
-- 返していなかったため、**公開ページの予約枠は営業時間を反映しようが無かった**
-- （実際、10:00-21:00 が直書きされていた。2026-08-15 に発覚）。
--
-- operating_hours は公開情報（予約ページに営業時間として表示される値）なので、
-- anon に返して問題ない。
--
-- ⚠️ RETURNS TABLE の列を増やすのは「戻り値の型の変更」なので
--    CREATE OR REPLACE では通らない。DROP してから作り直す。
--    **DROP すると GRANT が消える**ので、下で明示的に戻すこと
--    （Supabase の既定権限で anon/authenticated には自動で付くが、
--      それに頼ると「既定が変わったら壊れる」ため明示する）。
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);

CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
RETURNS TABLE(
  id uuid,
  gym_name text,
  gym_name_short text,
  address text,
  logo_url text,
  primary_color text,
  trial_info_title text,
  trial_info_body text,
  booking_buffer_minutes integer,
  slot_duration_minutes integer,
  booking_capacity integer,
  booking_cutoff_type text,
  booking_cutoff_hours integer,
  trial_price_yen integer,
  operating_hours jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours,
         t.trial_price_yen, t.operating_hours
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$function$;

-- DROP で消えた権限を戻す（元の proacl と同じ構成）
GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_tenant_public(uuid) IS
  '公開ページ（体験予約・ドロップイン）が anon で読むテナントの公開情報。'
  'operating_hours を含む（予約枠を営業時間に合わせるため。2026-08-15 追加）。';
