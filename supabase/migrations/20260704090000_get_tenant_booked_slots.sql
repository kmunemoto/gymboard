-- 公開予約サイト(体験予約)用: テナント限定の埋まり枠取得 RPC (日付範囲版)。
--
-- 背景: 既存の get_booked_slots(check_date) は全テナント横断で埋まり枠を返すため、
-- 公開APIとしてはテナントを跨いだ予約状況が混ざる(他ジムの予約で枠が埋まって見える)。
-- 本関数は tenant_id で絞り込み、さらに日付範囲を1回で返す
-- (公開ページの「60日分×60回のRPC呼び出し」を1回にできる)。
--
-- tenant_id が NULL の旧データ行は、二重予約防止を優先して「埋まり」として含める
-- (RESTRICTIVE RLS では不可視だが、物理的な枠は塞がっているため)。
--
-- 返す情報は 日時範囲 + ステータス文字列のみ (氏名等の個人情報は含まない)。
CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots(p_tenant_id uuid, from_date date, to_date date)
RETURNS TABLE(booking_date timestamp with time zone, end_booking_date timestamp with time zone, status text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 不正・過大な範囲要求は空を返す (公開エンドポイントの負荷対策; 最大93日)
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT tb.booking_date, tb.booking_date + interval '75 minutes' AS end_booking_date, tb.status
  FROM public.trial_bookings tb
  WHERE (tb.tenant_id = p_tenant_id OR tb.tenant_id IS NULL)
    AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT b.booking_date, b.booking_date + interval '75 minutes' AS end_booking_date, b.status
  FROM public.bookings b
  WHERE (b.tenant_id = p_tenant_id OR b.tenant_id IS NULL)
    AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT bs.blocked_date AS booking_date, bs.end_blocked_date AS end_booking_date, 'ブロック済み' AS status
  FROM public.blocked_slots bs
  WHERE (bs.tenant_id = p_tenant_id OR bs.tenant_id IS NULL)
    AND (bs.blocked_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_booked_slots(uuid, date, date) TO anon, authenticated;
