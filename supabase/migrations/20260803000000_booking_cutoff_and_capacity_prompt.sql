-- 予約の締切設定を実際に効かせる／同時受入数を既存店に確認できるようにする（2026-08-03）
--
-- 背景は mem/features/booking-cutoff.md と mem/features/booking-capacity.md。

-- ---------------------------------------------------------------------------
-- 1. 公開ページ（体験予約・ドロップイン）でも締切設定を読めるようにする
--
-- tenants.booking_cutoff_type / booking_cutoff_hours はオンボーディングで
-- 店に聞いて保存していたが、予約ロジックが一度も読んでいなかった（死んだ列）。
-- クライアント側を直したので、公開ページ用の RPC でも返す必要がある。
-- 返さないと未ログインの公開ページだけが prev_day 固定のままになる。
--
-- 既存の列・条件は一切変えていない（booking_cutoff_* の2列を足しただけ）。
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);
CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
RETURNS TABLE (
  id uuid, gym_name text, gym_name_short text, address text,
  logo_url text, primary_color text, trial_info_title text, trial_info_body text,
  booking_buffer_minutes integer, slot_duration_minutes integer, booking_capacity integer,
  booking_cutoff_type text, booking_cutoff_hours integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 「同時に受けられる予約数」を店に確認したかどうかを持つ
--
-- booking_capacity は既定 1 で、2026-08-02 に本番を見たら14テナント全部が
-- 既定のままだった。実際は2人で回している店でも、空いている枠が「満枠」と出る。
--
-- ここで値そのものを推測して書き換えては**いけない**。本当に1対1の店で
-- 二重予約を通すと、お客様が来たのに対応者がいないという、より重い実害になる
-- （mem/features/booking-capacity.md「業種で既定値を決めようとしないこと」）。
--
-- 代わりに「聞いたかどうか」を持ち、まだ聞いていない店にだけ確認を出す。
-- NULL = 未確認。既存の14テナントは全部 NULL から始まる。
-- 「1で正しい」と答えた店もタイムスタンプが入るので、二度は聞かない。
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_capacity_confirmed_at timestamptz;

COMMENT ON COLUMN public.tenants.booking_capacity_confirmed_at IS
  '同時に受けられる予約数を店が明示的に確認した日時。NULL は未確認（＝既定値1のまま放置されている可能性がある）。値の推測には使わない。';
