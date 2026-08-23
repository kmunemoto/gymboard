-- 受付しない時間帯（GB006）の拒否メッセージを「満枠」の体裁にする（2026-08-23）
--
-- 店の要望:「受付外」ではなく普通に埋まっている状況と同じ「満枠」で見せたい。
-- 帯で意図的に閉めていることがお客様に見えると、この仕組みの意味が薄れるため、
-- 新クライアントはグリッドの帯の枠を「満枠」と完全に同じ表示にした。
--
-- この migration はその DB 側: GB006 の RAISE メッセージを満枠の体裁に変える。
-- このメッセージが実際にお客様へ届くのは**帯機能より前の旧クライアントだけ**
-- （帯を知らないので枠を「空き」と表示し、押すと GB006 が返る）。そこで
-- 「受け付けていません」と出ると仕組みが漏れるので、文言だけ揃える。
--
-- 🔴 変えるのはメッセージ文字列だけ。ERRCODE 'GB006' は変えない
--    （クライアントの検出は error.code。文言では判定していない）。
--    判定ロジック（免除が先・開区間・自己予約のみ・復活の例外）は
--    20260821080000 の定義から一字も変えずに写している。
CREATE OR REPLACE FUNCTION public.guard_booking_blocked_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID;
  v_jst   TIMESTAMP;
  v_dow   INT;
  v_min   INT;
BEGIN
  -- 🔴 お客様が自分で取る予約だけを見る（代理・サービスロールは店の裁量）
  v_actor := auth.uid();
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 日時が変わらない UPDATE は見ない。'キャンセル済み' からの復活は例外
  -- （キャンセル行を帯の中に先に置き、あとで復活させるバイパスを塞ぐ。GB003 と同じ）
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  v_jst := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo');
  v_dow := EXTRACT(DOW FROM v_jst)::int;
  v_min := EXTRACT(HOUR FROM v_jst)::int * 60 + EXTRACT(MINUTE FROM v_jst)::int;

  -- 🔴 免除が先（免除は塞ぐ帯より強い）。免除行の時間帯は閉区間（制限側の規則のまま）。
  IF EXISTS (
    SELECT 1 FROM public.booking_frequency_limits l
     WHERE l.tenant_id = NEW.tenant_id
       AND l.enabled
       AND l.exempt
       AND l.user_id = NEW.user_id
       AND v_dow = ANY (l.weekdays)
       AND v_min >= (split_part(l.start_time, ':', 1)::int * 60 + split_part(l.start_time, ':', 2)::int)
       AND v_min <= (split_part(l.end_time,   ':', 1)::int * 60 + split_part(l.end_time,   ':', 2)::int)
  ) THEN
    RETURN NEW;
  END IF;

  -- 🔴 帯は開区間 (start, end)。両端ちょうどの開始は受け付ける（残したい2枠そのもの）。
  IF EXISTS (
    SELECT 1 FROM public.booking_blocked_windows w
     WHERE w.tenant_id = NEW.tenant_id
       AND w.enabled
       AND v_dow = ANY (w.weekdays)
       AND v_min > (split_part(w.start_time, ':', 1)::int * 60 + split_part(w.start_time, ':', 2)::int)
       AND v_min < (split_part(w.end_time,   ':', 1)::int * 60 + split_part(w.end_time,   ':', 2)::int)
  ) THEN
    RAISE EXCEPTION 'この枠は満枠のためご予約いただけません'
      USING ERRCODE = 'GB006';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_booking_blocked_window() FROM PUBLIC, anon, authenticated;
