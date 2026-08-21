-- ============================================================================
-- 予約回数の制限: 時間帯の終端を「含む」に変える（[start, end) → [start, end]）
-- ============================================================================
--
-- 実店舗からの報告（2026-08-21）: 「平日 18:00〜19:00 は週1回まで」を設定したら、
-- 18:00〜18:45 開始の枠は塞がったのに **19:00 開始の枠が素通りした**。
-- 店の読みは「〜19:00」=「19:00 の回まで」。設定した本人が意図と違うと感じる
-- 境界は、他の店でも同じように誤解される。
--
-- そこで booking_frequency_limits の時間帯は**閉区間 [start, end]** にする:
-- 終了時刻は「最後にカバーする開始時刻」。18:00〜19:00 のルールは
-- 18:00・18:15・…・19:00 ちょうどに始まる予約に効き、19:15 開始には効かない。
--
-- ## 🔴 容量の帯（booking_capacity_windows）は半開区間 [start, end) のまま
--
-- 同じ「曜日×時間帯」の見た目でも意味が違う。あちらは「その時間に居る
-- スタッフの数」で、10:00〜12:00 に応援が居る帯（capacity 3）を 12:00 開始の
-- 予約に効かせると、**応援が帰った後の枠を3件受けてしまう**。
-- 期間としての帯は半開、開始時刻の範囲としてのルールは閉区間、と使い分ける。
--
-- ## 変えるのは比較演算子3箇所だけ
--
--   1. 免除（exempt）の EXISTS の終端     … 免除も 19:00 開始まで届かないと
--      「免除したのに終端の回だけ拒否される」ねじれが出る
--   2. 制限ルールのマッチの終端
--   3. 既存予約を数えるクエリの終端       … ここを変え忘れると「19:00 開始は
--      塞ぐのに、既にある 19:00 開始の予約は数えない」で判定が自分と矛盾する
--
-- クライアント（src/lib/bookingLimits.ts）も同時に同じ3箇所を変えている。
-- end_time の "24:00"（その日いっぱい）は実在する開始時刻の最大が 23:59 なので
-- 閉区間にしても挙動は変わらない。
--
-- ⚠️ 20260821050000 の定義に対する変更は上記3箇所の <  → <= のみ。
--    他（代理の素通し・キャンセル復活の例外・advisory lock・数え方）はそのまま。
--    CREATE OR REPLACE は最後の定義しか残らないので全文を書く。
CREATE OR REPLACE FUNCTION public.guard_booking_frequency_limit()
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
  v_limit RECORD;
  v_from  DATE;
  v_to    DATE;
  v_count INT;
BEGIN
  -- 🔴 お客様が自分で取る予約だけを見る。
  --    代理予約（auth.uid() ≠ user_id）とサービスロール（auth.uid() IS NULL）は
  --    店の裁量なので制限しない。
  v_actor := auth.uid();
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;   -- テナント不明では判定しようがない（他のトリガーの担当）
  END IF;

  -- 日時が変わらない UPDATE は見ない。ただし 'キャンセル済み' からの復活は例外
  -- （キャンセル行を先に置く→別の枠を取る→復活、のバイパスを塞ぐ）。
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  -- 同一人物の同時リクエストのレース対策（トランザクション終了で自動解放）
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || NEW.user_id::text));

  v_jst := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo');
  v_dow := EXTRACT(DOW FROM v_jst)::int;
  v_min := EXTRACT(HOUR FROM v_jst)::int * 60 + EXTRACT(MINUTE FROM v_jst)::int;

  -- 🔴 免除が先。マッチする免除が1件でもあれば、この予約は制限を一切受けない。
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

  FOR v_limit IN
    SELECT l.*
      FROM public.booking_frequency_limits l
     WHERE l.tenant_id = NEW.tenant_id
       AND l.enabled
       AND NOT l.exempt
       AND (l.user_id IS NULL OR l.user_id = NEW.user_id)
       AND v_dow = ANY (l.weekdays)
       AND v_min >= (split_part(l.start_time, ':', 1)::int * 60 + split_part(l.start_time, ':', 2)::int)
       AND v_min <= (split_part(l.end_time,   ':', 1)::int * 60 + split_part(l.end_time,   ':', 2)::int)
  LOOP
    IF v_limit.period = 'day' THEN
      v_from := v_jst::date;
      v_to   := v_from + 1;
    ELSE
      v_from := date_trunc('week', v_jst)::date;
      v_to   := v_from + 7;
    END IF;

    SELECT count(*) INTO v_count
      FROM public.bookings b
     WHERE b.tenant_id = NEW.tenant_id
       AND b.user_id   = NEW.user_id
       AND b.id IS DISTINCT FROM NEW.id
       AND b.status <> 'キャンセル済み'
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date >= v_from
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date <  v_to
       AND EXTRACT(DOW FROM (b.booking_date AT TIME ZONE 'Asia/Tokyo'))::int = ANY (v_limit.weekdays)
       AND (EXTRACT(HOUR FROM (b.booking_date AT TIME ZONE 'Asia/Tokyo'))::int * 60
          + EXTRACT(MINUTE FROM (b.booking_date AT TIME ZONE 'Asia/Tokyo'))::int)
           >= (split_part(v_limit.start_time, ':', 1)::int * 60 + split_part(v_limit.start_time, ':', 2)::int)
       AND (EXTRACT(HOUR FROM (b.booking_date AT TIME ZONE 'Asia/Tokyo'))::int * 60
          + EXTRACT(MINUTE FROM (b.booking_date AT TIME ZONE 'Asia/Tokyo'))::int)
           <= (split_part(v_limit.end_time, ':', 1)::int * 60 + split_part(v_limit.end_time, ':', 2)::int);

    IF v_count >= v_limit.max_bookings THEN
      RAISE EXCEPTION 'この時間帯に取れるご予約の回数が上限に達しています'
        USING ERRCODE = 'GB003';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
