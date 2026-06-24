-- 体験予約(trial_bookings)が GymBoard に同期されない不具合の修正
--
-- 背景:
--   2026-06-22 の migration (20260622052428) で check_booking_overlap() の先頭に
--   `IF NEW.source = 'salute_sync' THEN RETURN NEW; END IF;` を追加した。
--   しかし check_booking_overlap() は BEFORE INSERT トリガとして
--     - public.bookings        (source 列あり)
--     - public.trial_bookings  (source 列なし)
--   の両方に紐づいている (prevent_booking_overlap / prevent_trial_booking_overlap)。
--   trial_bookings には source 列が無いため、NEW.source の参照が
--   「record "new" has no field "source"」(SQLSTATE 42703) で失敗し、
--   trial_bookings への INSERT が全て拒否されていた。
--
--   結果として 7月以降の初回無料体験予約 (gymboard-sync-trial-booking 経由で
--   trial_bookings に INSERT される分) が GymBoard に反映されず、
--   予約レコードに紐づくメール/プッシュ通知も送信されなかった。
--   6月分は同期カットオフ (SYNC_CUTOFF=2026-07-01) により INSERT 自体を行わない
--   ため、この不具合の影響を受けていなかった。
--
-- 修正:
--   source 列を持たないテーブル(trial_bookings)でもクラッシュしないよう、
--   NEW.source を to_jsonb(NEW) ->> 'source' 経由で安全に参照する。
--   - bookings        : これまで通り source='salute_sync' のミラーは重複チェックをスキップ
--   - trial_bookings  : source が存在しない → 2026-06-22 以前と同じく通常の重複チェックを実施
CREATE OR REPLACE FUNCTION public.check_booking_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_start timestamptz;
  new_end timestamptz;
  overlap_count integer;
BEGIN
  -- Salute からのミラー予約は Salute 側で既に整合性が取れているのでスキップ。
  -- source 列を持たないテーブル(trial_bookings 等)でも参照がエラーにならないよう
  -- to_jsonb 経由で取得する (列が無い場合は NULL となり、スキップ条件に合致しない)。
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  new_start := NEW.booking_date;
  new_end := NEW.booking_date + interval '75 minutes';

  SELECT COUNT(*) INTO overlap_count
  FROM (
    SELECT booking_date AS start_at, booking_date + interval '75 minutes' AS end_at
    FROM public.bookings
    WHERE status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
      AND tenant_id = NEW.tenant_id
      AND (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT booking_date AS start_at, booking_date + interval '75 minutes' AS end_at
    FROM public.trial_bookings
    WHERE status != 'キャンセル済み'
      AND id IS DISTINCT FROM NEW.id
      AND tenant_id = NEW.tenant_id
      AND (booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT blocked_date AS start_at, end_blocked_date AS end_at
    FROM public.blocked_slots
    WHERE tenant_id = NEW.tenant_id
      AND (blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) AS existing
  WHERE new_start < existing.end_at
    AND existing.start_at < new_end;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  RETURN NEW;
END;
$function$;
