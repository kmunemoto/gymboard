-- ============================================================================
-- 営業時間外の予約も、1日の上限に数える（2026-10-23）
--
-- 2026-10-17 に「時間外の予約は1日の上限に数えない」と決めて入れた
-- （20261017010000_outside_hours_bookings.sql）。その結果、本番で次のことが起きた:
--
--   ある日曜: 会員の予約5件（うち1件は店が入れた営業時間外 08:45）＋ 体験0件
--   → 会員は4件と数えられ、合計（体験込み）も4件 → 体験予約が通って、その日は6件になった
--
-- 宗本さん「すでに5枠埋まってる日はもう体験も受け付けない。全ての予約を合わせて1日5枠まで」。
-- 確認: 時間外の予約は**会員の上限（4枠・週1日の5枠）にも数える**（「どの予約も同じ1枠」）。
--
-- したがって数え方から「営業時間外を除く」を外す。数え方は2か所にあり、両方そろえる:
--   tenant_day_booking_count … 合計の上限（tenant_day_total_reached）が使う
--   tenant_member_day_counts … 会員の上限・週の多い日（tenant_member_day_limits）が使う
--
-- 時間外の印（bookings.outside_hours）そのものは残す。担当のシフト外でも入れられる（GB002）・
-- 予定表の「時間外」の印・お客様の日時変更を止める、には引き続き使う。
-- ============================================================================

COMMENT ON COLUMN public.bookings.outside_hours IS
  '営業時間外（または定休日）に店がイレギュラーで入れた予約。true のとき: 担当のシフト外でも入れられる。1日の上限にはほかの予約と同じく数える（2026-10-23〜）。付けられるのは店のスタッフとサービスロールだけ（guard_booking_outside_hours_flag）';

CREATE OR REPLACE FUNCTION public.tenant_day_booking_count(
  p_tenant_id uuid,
  p_date date,
  p_exclude_booking_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT count(*)::integer FROM public.bookings b
   WHERE b.tenant_id = p_tenant_id
     AND b.status <> 'キャンセル済み'
     AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
     AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = p_date;
$fn$;
REVOKE ALL ON FUNCTION public.tenant_day_booking_count(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

-- 🔴 数え方は tenant_day_booking_count と同じにすること（キャンセル済み以外・JST の日付）。
CREATE OR REPLACE FUNCTION public.tenant_member_day_counts(
  p_tenant_id uuid,
  from_date date,
  to_date date,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS TABLE(day date, n integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date, count(*)::integer
    FROM public.bookings b
   WHERE b.tenant_id = p_tenant_id
     AND b.status <> 'キャンセル済み'
     AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
     AND b.booking_date >= (from_date::timestamp AT TIME ZONE 'Asia/Tokyo')
     AND b.booking_date <  ((to_date + 1)::timestamp AT TIME ZONE 'Asia/Tokyo')
   GROUP BY 1;
$fn$;
REVOKE ALL ON FUNCTION public.tenant_member_day_counts(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;
