-- ============================================================================
-- 体験を「無料」から「ジムごとに決める料金」へ（2026-08-08）
-- ============================================================================
--
-- Salute御所南が体験を有料に切り替えた。
--
--   体験トレーニング     ¥3,000（税込）
--   当日に入会した       ¥0（頂かない）
--   当日に入会しなかった  ¥3,000 を当日いただく
--
-- ── 🔴 これは1ジムの都合であって、全ジムの仕様ではない ──────────
--
-- 本番には**14テナント**いる。無料体験で集客しているジムもありうるので、
-- **金額をコードに書いてはいけない。** テナントの設定として持つ。
-- （CLAUDE.md「特定テナント専用の変更を全テナントに適用しない」）
--
-- このマイグレーションは**入れ物だけ**を作る。
-- Salute の 3000 は本番で個別に入れる（このファイルには書かない）。
--
-- ── 「無料」の文言はもともと Salute だけに出ていた ────────────
--
-- `isFreeTrial`（= tenantId === Salute）で分岐しており、他13ジムは最初から
-- 「体験」表記だった。今回それを全ジム「体験トレーニング」に揃える。
-- **料金を語らない呼称**なので、他ジムに実害は無い。
--
-- ⚠️ **DBの値 `'初回無料体験'`（bookings.booking_type の既定）は据え置く。**
--    これは表示文字列ではなく**内部キー**として使われている:
--      PlanUsageCard.tsx    EXCLUDED_PLAN_NAMES
--      CustomerHome.tsx     hasPlan の判定
--      planSlotDuration     プラン別の所要時間
--    改名すると既存行と突き合わなくなる。表示ラベルだけ変える方針は
--    CustomerBooking.tsx:54 で既に採っているのと同じ。
--
-- 検査: src/test/trialPricing.test.ts
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 体験料金（ジムごと）
-- ----------------------------------------------------------------------------
-- NULL = 料金を表示しない（＝これまでどおり）。0 は「¥0 と明示する」で NULL とは違う。
-- 税込の円。小数は扱わない。

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_price_yen integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_trial_price_yen_range'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_trial_price_yen_range
      CHECK (trial_price_yen IS NULL OR (trial_price_yen >= 0 AND trial_price_yen <= 1000000));
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.trial_price_yen IS
  '体験トレーニングの料金（税込・円）。NULL は「料金を表示しない」で、0（無料と明示）とは違う。'
  'ジムごとの設定であって、コードに金額を書かないこと。';


-- ----------------------------------------------------------------------------
-- 2. 体験料をいただいたかの記録
-- ----------------------------------------------------------------------------
-- **アプリは決済しない。** 現金・カード・QR はこれまでどおり店頭の手段で受け取る。
-- ここに持つのは「その結果どうなったか」だけ。
--
-- NULL = 未記録（料金を設定していないジムでは、そもそも画面に出さない）。

ALTER TABLE public.trial_bookings
  ADD COLUMN IF NOT EXISTS trial_fee_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trial_bookings_trial_fee_status_check'
  ) THEN
    ALTER TABLE public.trial_bookings
      ADD CONSTRAINT trial_bookings_trial_fee_status_check
      CHECK (trial_fee_status IS NULL
             OR trial_fee_status IN ('未確認', '頂いた', '入会のため免除'));
  END IF;
END $$;

COMMENT ON COLUMN public.trial_bookings.trial_fee_status IS
  '体験料の徴収結果。未確認 / 頂いた / 入会のため免除。NULL は未記録。'
  'アプリは決済を行わない。店頭で受け取った結果を記録するだけの欄。';


-- ----------------------------------------------------------------------------
-- 3. get_tenant_public に料金を足す
-- ----------------------------------------------------------------------------
-- 🔴 **戻り値の型が変わるので CREATE OR REPLACE では通らない。**
--    `cannot change return type of existing function` になるため DROP してから作る。
--
-- 🔴 **DROP すると ACL が消える。** この関数は
--    **未ログインの体験予約ページが呼ぶ3関数のうちの1つ**で、
--    anon の EXECUTE を落とすと**予約ページが真っ白になる。**
--    下で必ず GRANT し直すこと。適用後は `SET LOCAL ROLE anon` で実際に読んで確かめる
--    （has_function_privilege が true でも足りない。mem/ops/tenant-boundary.md 穴8）。

DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);

CREATE FUNCTION public.get_tenant_public(p_id uuid)
RETURNS TABLE (
  id uuid, gym_name text, gym_name_short text, address text,
  logo_url text, primary_color text, trial_info_title text, trial_info_body text,
  booking_buffer_minutes integer, slot_duration_minutes integer, booking_capacity integer,
  booking_cutoff_type text, booking_cutoff_hours integer,
  trial_price_yen integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours,
         t.trial_price_yen
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;

-- ⚠️ ここを消さないこと。未ログインの予約ページがこの1行で生きている。
GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated;

-- 返している列に個人情報が無いことは確認済み（ジム名・ロゴ・営業設定・料金のみ）。
COMMENT ON FUNCTION public.get_tenant_public(uuid) IS
  '未ログインの体験・ドロップイン予約ページが読む公開情報。anon から実行できる。'
  '個人情報を足さないこと。列を足すときは DROP+CREATE になるので GRANT の再付与を忘れない。';
