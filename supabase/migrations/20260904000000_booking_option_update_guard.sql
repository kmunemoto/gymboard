-- ============================================================================
-- あとからオプションを足すとき、後ろが空いているかを確かめる（GB008）
-- ============================================================================
--
-- 実店舗の要望（2026-09-03 宗本さん）:
--   「あとからオプション追加したいっていう人もいるかもなので追加して。
--     でもそれはお店側で追加する。後ろがもう埋まってたら無理だしね」
--
-- ## 🔴 なぜトリガーが要るのか（ここが本体）
--
-- 重複判定（`check_booking_overlap`）は **BEFORE INSERT にしか刺さっていない**。
-- 予約の日時変更が「新しい枠を作ってから古い枠を消す」で実現されているので、
-- UPDATE を見る必要が無かった（20260804000000 の方針）。
--
-- ところが「あとからオプションを足す」は **UPDATE で占有だけを伸ばす**操作で、
-- 今のままだと**何の検査も通らない**。60分の予約に30分を足すと、
-- 予定表の上では黙って105分に伸び、**すでに入っている次のお客様の枠を飲み込む**。
-- 画面には2件が重なって表示され、当日まで誰も気づかない。
--
-- なので、伸ばす UPDATE だけを見る専用のトリガーをここで足す。
-- `guard_booking_staff_reassign`（担当の差し替えだけを見る BEFORE UPDATE）と同じ形。
--
-- ## 短くする方向は素通し
--
-- オプションを外す・減らすと占有は縮む。縮む方向で他の予約とぶつかることは無いので、
-- 増えたときだけ検査する。「増えていないなら即 RETURN」を最初に置いてあるので、
-- キャンセル・消化・メモ追記・担当変更といった**他のあらゆる UPDATE は今までどおり素通り**する
-- （ここを間違えると、予約のキャンセルまで巻き添えで落ちる）。
--
-- ## 判定は check_booking_overlap と同じ形にする
--
-- 「新しい占有 [開始, 開始+1枠+オプション+間) に、自分以外の予約・体験・ブロックが
-- いくつ重なるか」を数え、同時受け入れ数（時間帯の帯 → 店の既定値）と比べる。
-- 自分自身は `id IS DISTINCT FROM NEW.id` で除く。
-- 元の占有の中に重なっているものは元から合法なので、同じ数え方でよい。
--
-- ## SQLSTATE は GB008（この用途専用）
--
--   GB001 担当が埋まっている       GB002 担当がシフト外
--   GB003 時間帯の回数上限         GB004 プランの回数上限
--   GB006 受付しない時間帯         GB007 その日は受付終了
--   GB008 **オプションを追加できない（後ろが空いていない）**  ← ここで新設
--
-- 満枠の文言（文言一致で判定している経路がある）と混ぜない。店員に出す案内が
-- 「別の時間なら取れる」ではなく「この予約は伸ばせない」で、対処が違うため。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_booking_option_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old_option integer;
  v_new_option integer;
  buffer_min integer;
  tenant_session_min integer;
  new_session_min integer;
  capacity_limit integer;
  new_start timestamptz;
  new_end timestamptz;
  overlap_count integer;
  blocked_count integer;
  staff_conflict_count integer;
  v_staff uuid;
BEGIN
  v_old_option := GREATEST(COALESCE(OLD.option_minutes, 0), 0);
  v_new_option := GREATEST(COALESCE(NEW.option_minutes, 0), 0);

  -- 🔴 増えていない UPDATE は**必ず**素通し。キャンセル・消化・メモ・担当変更など、
  --    予約に対する他のすべての更新がここを通るので、ここで落とすと影響が甚大。
  IF v_new_option <= v_old_option THEN
    RETURN NEW;
  END IF;

  -- キャンセル済みの予約は枠を持たない
  IF NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes
    INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = NEW.tenant_id;

  capacity_limit := public.resolve_booking_capacity(NEW.tenant_id, NEW.booking_date);

  SELECT tp.slot_duration_minutes INTO new_session_min
  FROM public.tenant_plans tp
  WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type
  LIMIT 1;
  new_session_min := COALESCE(new_session_min, tenant_session_min, 60);

  v_staff := NEW.staff_user_id;
  new_start := NEW.booking_date;
  -- 伸びたあとの占有。間は1回だけ（src/lib/bookingOptions.ts と同じ規則）
  new_end := NEW.booking_date
    + make_interval(mins => new_session_min + v_new_option + COALESCE(buffer_min, 15));

  SELECT
    COUNT(*) FILTER (WHERE existing.kind = 'block'),
    COUNT(*) FILTER (WHERE existing.kind = 'booking'),
    COUNT(*) FILTER (WHERE existing.kind = 'booking'
                       AND v_staff IS NOT NULL
                       AND existing.staff_user_id = v_staff)
  INTO blocked_count, overlap_count, staff_conflict_count
  FROM (
    SELECT 'booking' AS kind,
           b.booking_date AS start_at,
           b.booking_date + make_interval(mins =>
             COALESCE(tp.slot_duration_minutes, tenant_session_min, 60)
             + COALESCE(b.option_minutes, 0)
             + COALESCE(buffer_min, 15)
           ) AS end_at,
           b.staff_user_id
    FROM public.bookings b
    LEFT JOIN public.tenant_plans tp
      ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
    WHERE b.status != 'キャンセル済み'
      AND b.id IS DISTINCT FROM NEW.id
      AND b.tenant_id = NEW.tenant_id
      AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    -- 体験・ドロップインはオプションを持たない（列も無い）
    SELECT 'booking' AS kind,
           tb.booking_date AS start_at,
           tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_at,
           NULL::uuid AS staff_user_id
    FROM public.trial_bookings tb
    WHERE tb.status != 'キャンセル済み'
      AND tb.tenant_id = NEW.tenant_id
      AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    UNION ALL
    SELECT 'block' AS kind,
           blocked_date AS start_at,
           end_blocked_date AS end_at,
           NULL::uuid AS staff_user_id
    FROM public.blocked_slots
    WHERE tenant_id = NEW.tenant_id
      AND (blocked_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
  ) AS existing
  WHERE new_start < existing.end_at
    AND existing.start_at < new_end;

  IF blocked_count > 0 OR overlap_count >= capacity_limit OR staff_conflict_count > 0 THEN
    RAISE EXCEPTION 'この予約の後ろが空いていないため、オプションを追加できません'
      USING ERRCODE = 'GB008';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_booking_option_change ON public.bookings;
CREATE TRIGGER trg_guard_booking_option_change
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_option_change();
