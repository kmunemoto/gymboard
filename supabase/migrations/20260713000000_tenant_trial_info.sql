-- 体験予約ページの案内カード（見出し＋説明文）をジムごとに設定できるようにする。
-- 「手ぶらでOK」等はジムによって異なるため、テナント単位でカスタム文言を持てるようにする。
-- どちらも NULL 可。NULL/空のときはアプリ側の既定文言（i18n trialBooking.infoTitle/infoBody）を表示する。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_info_title TEXT,
  ADD COLUMN IF NOT EXISTS trial_info_body  TEXT;

COMMENT ON COLUMN public.tenants.trial_info_title IS
  '体験予約ページの案内カード見出し。NULL/空なら既定文言を表示。';
COMMENT ON COLUMN public.tenants.trial_info_body IS
  '体験予約ページの案内カード説明文。NULL/空なら既定文言を表示。';

-- 公開の体験予約ページ（anon）はこの SECURITY DEFINER 関数経由でテナント情報を読む。
-- RETURNS TABLE の列を増やすため、一度 DROP してから作り直す（CREATE OR REPLACE では
-- 戻り値の型変更ができないため）。GRANT も再付与する。
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);

CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
RETURNS TABLE (
  id uuid,
  gym_name text,
  gym_name_short text,
  address text,
  logo_url text,
  primary_color text,
  trial_info_title text,
  trial_info_body text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body
  FROM public.tenants t
  WHERE t.id = p_id
    AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated;
