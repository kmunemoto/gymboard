-- ============================================================================
-- 受付開始時期（何日先まで予約を受けるか）と、曜日別の営業時間・定休日
-- ============================================================================
--
-- エアリザーブの「受付開始時期」「営業時間（曜日別）」「定休日」に当たる2件。
-- まとめてあるのは、どちらも `tenants` の「予約を受ける範囲」の設定で、
-- 設定画面でも隣り合って出るため。
--
-- ## 1. booking_window_days（受付の「先」の上限）
--
-- 締切（booking_cutoff_type / booking_cutoff_hours）は「手前」の締めしか決められない。
-- 「先」の上限は**設定がどこにも無く、画面ごとに違う数字が直書きされていた**:
--
--   お客様の予約  … addMonths(today, 1)                  → 1ヶ月先
--   体験予約      … TRIAL_BOOKING_MAX_DAYS_AHEAD = 10    → 10日先
--   ドロップイン  … DROP_IN_BOOKING_MAX_DAYS_AHEAD = 10  → 10日先
--   予約を追加    … 無し                                  → 無制限
--
-- 🔴 **NULL は「未設定」で、画面ごとの従来の上限をそのまま使う。**
--    列を足しただけで既存店の見え方が変わってはいけないので、backfill しない
--    （cancel_policy と同じ方針。src/test/cancelPolicy.test.ts が backfill を禁じている）。
--
-- ## 2. 曜日別の営業時間・定休日（DDL 無し）
--
-- `operating_hours` は既に jsonb なので**列は増やさない**。中身に `days` を足す:
--
--   {
--     "start": "10:00",          ← 開いている曜日を通した「いちばん早い開店」
--     "end":   "23:00",          ← 開いている曜日を通した「いちばん遅い閉店」
--     "days": {
--       "0": null,                                  ← 日曜=定休日
--       "1": { "start": "10:00", "end": "21:00" },
--       "6": { "start": "09:00", "end": "23:00" }
--     }
--   }
--
-- 🔴 **`start`/`end` には「包絡線」を書き続ける。**
--    ネイティブアプリなので、`days` を知らない版が端末に何ヶ月も残る。その版は
--    `start`/`end` しか読まないので、包絡線なら「広めに出る」だけで済む。
--    月曜の時間だけを入れると、土曜に取れるはずの枠が古い版から消える。
--    包絡線の計算はクライアント側 `src/lib/businessHours.ts: envelopeFromDays()`。
--
--    列を増やしていないので **get_tenant_public は 2026-08-15 版のままで
--    `days` まで公開ページに届く**（jsonb を丸ごと返しているため）。
--    ここで作り直すのは booking_window_days を足すためだけ。
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS booking_window_days INTEGER;

-- 1日〜365日。0 や負値は「未設定」と区別できないうえ、0 を「当日のみ」と解釈すると
-- 設定ミス1つで店の予約が全部止まる。止めたいなら定休日か締切で止める。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_booking_window_days_range'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_booking_window_days_range
      CHECK (booking_window_days IS NULL OR (booking_window_days BETWEEN 1 AND 365));
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.booking_window_days IS
  '何日先まで予約を受け付けるか（今日を0日目として数える）。'
  'NULL = 未設定で、画面ごとの従来の上限（会員は1ヶ月・公開ページは10日）に従う。'
  'src/lib/bookingWindow.ts が唯一の解釈者。';

COMMENT ON COLUMN public.tenants.operating_hours IS
  '営業時間。{"start":"HH:MM","end":"HH:MM"} に加えて、曜日別の "days" を持てる '
  '（キーは "0"=日〜"6"=土。値 null = 定休日。キーが無い曜日は start/end を使う）。'
  '🔴 start/end は「開いている曜日全体を包む包絡線」を書くこと。days を知らない'
  '古いアプリ版が端末に残るため、そこが狭いと取れるはずの枠が消える。'
  '解釈は src/lib/businessHours.ts に集約。';

-- ============================================================================
-- get_tenant_public に booking_window_days を足す
-- ============================================================================
-- 公開ページ（体験予約 /trial、ドロップイン /dropin）は anon から
-- get_tenant_public 経由でしかテナントを読めない。受付の上限は公開情報
-- （予約カレンダーで選べる範囲としてそのまま見える値）なので anon に返してよい。
--
-- ⚠️ RETURNS TABLE の列を増やすのは「戻り値の型の変更」なので CREATE OR REPLACE では
--    通らない。DROP してから作り直す。**DROP すると GRANT が消える**ので下で明示的に戻す
--    （2026-08-15 に operating_hours を足したときと同じ手順）。
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
  operating_hours jsonb,
  booking_window_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours,
         t.trial_price_yen, t.operating_hours, t.booking_window_days
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$function$;

-- DROP で消えた権限を戻す（元の proacl と同じ構成）
GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_tenant_public(uuid) IS
  '公開ページ（体験予約・ドロップイン）が anon で読むテナントの公開情報。'
  'operating_hours（曜日別・定休日を含む）と booking_window_days を含む。';
