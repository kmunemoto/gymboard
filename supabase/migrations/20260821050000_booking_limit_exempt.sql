-- ============================================================================
-- 予約回数の制限の「免除」（booking_frequency_limits.exempt）
-- ============================================================================
--
-- 「平日18-19時は週1回まで」の全員向けルールを入れたあとで、
-- **特定のお客様だけをその制限から外したい**という需要がある:
--
--   - 週2回コースの契約をしている常連さん
--   - リハビリ中で決まった時間にしか来られない方
--   - 家族2人で1枠を共有しているケース
--
-- これまでの `booking_frequency_limits` は**締め付ける方向にしか書けなかった**
-- （全体ルール AND 個別ルール）。緩める側を足す。
--
-- ## 行の意味が2種類になる
--
--   exempt = false（既定・従来の全行） … 制限する。max_bookings 回まで
--   exempt = true                     … **免除する**。そのお客様はこの
--                                        曜日×時間帯で他のルールを受けない
--
-- ## 🔴 免除は必ず「特定のお客様」に対して作る
--
-- `exempt = true AND user_id IS NULL`（全員を免除）は**ルールを消すのと同じ**で、
-- 存在すると「全員向けの制限」と「全員向けの免除」が並んで、どちらが効くのか
-- 行を見ても分からなくなる。CHECK で禁止する。
--
-- ## 判定の順序
--
--   1. その予約（曜日・開始時刻・予約者）にマッチする **exempt=true の行**を探す
--   2. 1件でもあれば **その予約は制限を一切受けない**（即通過）
--   3. 無ければ従来どおり、マッチする制限ルールを全部評価する（AND）
--
-- 「免除が制限より強い」。逆（制限が勝つ）にすると免除を作った意味が無くなる。
--
-- ## 免除は時間帯ごとに作れる
--
-- 「この人は平日夜だけ免除、土曜午前は全員と同じ制限」が表現できる。
-- 免除行にも曜日・時間帯を持たせているのはそのため（`max_bookings` は
-- 免除行では意味を持たないが、列は共有する。既定値 1 のまま置かれる）。
-- ============================================================================

ALTER TABLE public.booking_frequency_limits
  ADD COLUMN IF NOT EXISTS exempt BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.booking_frequency_limits.exempt IS
  'true = この行は「制限」ではなく「免除」。そのお客様はこの曜日×時間帯で'
  '他のどのルールも受けない（免除は制限より強い）。免除は必ず user_id を伴う。';

-- 🔴 全員を免除するルールは作らせない（制限ルールを消すのと同じで、
--    並んでいるとどちらが効くのか行を見て分からなくなる）。
ALTER TABLE public.booking_frequency_limits
  DROP CONSTRAINT IF EXISTS booking_frequency_limits_exempt_needs_user;
ALTER TABLE public.booking_frequency_limits
  ADD CONSTRAINT booking_frequency_limits_exempt_needs_user
  CHECK (NOT exempt OR user_id IS NOT NULL);

-- ----------------------------------------------------------------------------
-- トリガー: 免除を先に見てから制限を評価する
-- ----------------------------------------------------------------------------
-- ⚠️ 20260821020000 の定義に**免除の早期リターンを足しただけ**。
--    他の部分（代理の素通し・キャンセル復活の例外・advisory lock・数え方）は
--    そのまま。CREATE OR REPLACE は最後の定義しか残らないので全文を書く。
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
       AND v_min <  (split_part(l.end_time,   ':', 1)::int * 60 + split_part(l.end_time,   ':', 2)::int)
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
       AND v_min <  (split_part(l.end_time,   ':', 1)::int * 60 + split_part(l.end_time,   ':', 2)::int)
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
           <  (split_part(v_limit.end_time, ':', 1)::int * 60 + split_part(v_limit.end_time, ':', 2)::int);

    IF v_count >= v_limit.max_bookings THEN
      RAISE EXCEPTION 'この時間帯に取れるご予約の回数が上限に達しています'
        USING ERRCODE = 'GB003';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
