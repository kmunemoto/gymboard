-- ============================================================================
-- プランの回数上限を強制する（allow_overflow = false のとき）
-- ============================================================================
--
-- `tenant_plans.max_sessions`（月4回・月8回…）は**以前から存在するが、
-- 表示だけで一度も強制されていなかった**。「残り0回」の赤いバッジが出ていても、
-- 押せば普通に予約できる。
--
-- `tenant_plans.allow_overflow` も**以前から存在するデッドカラム**で、
-- まさに超過の可否を切り替える意図で作られたまま未実装だった。新しい列を足さず、
-- この2つを繋いで動かす。
--
--   allow_overflow = true （既定・現在の全プラン） … 今までどおり。超過できる
--   allow_overflow = false                        … 上限に達したら GB004 で拒否
--
-- ## 🔴 超過を許さないときは「サイクルのロール」も止める
--
-- 既存の表示ロジック（`src/lib/courseProgress.ts` の `resolveEffectiveCycle`）は
-- **上限を超えた予約が入ると、その予約日を起算日にして次のサイクルへ進む**
-- （「回数を使い切ったら次のルーティンが始まる」という運用の反映）。
--
-- 超過を拒否するなら、この自動ロールは起きてはならない。もしロールしたままだと:
--   カード「1/8 残り7」  ←→  DB「上限に達しています」
-- という食い違いが、**設定をONにした時点で既に超過している既存のお客様**に必ず出る。
--
-- そこでクライアント側も `allowOverflow: false` でロールを止める
-- （`resolveEffectiveCycle` の引数）。これで表示と判定が常に一致する。
--
-- ## 数え方はクライアントと同一
--
--   窓   = getCycleWindow(profiles.cycle_start_date, 予約日, cycle_months)
--          応当日ベース。**応当日そのものは前サイクルに含む**（end は応当日の翌日）
--   lent = graceLentToPrevCount(...)
--          = min(前サイクルの残り, 猶予帯[窓頭, 窓頭+grace_days) の予約数)
--   used = 窓内の有効予約数 - lent
--   拒否条件: used >= max_sessions
--
-- 数える対象は**そのお客様の予約すべて**（`booking_type` では絞らない）。
-- 表示側（`PlanUsageCard`）が `myBookings` を丸ごと渡しているので、それに揃える。
-- 除外は `status = 'キャンセル済み'` のみ（**'同日キャンセル済み'（消化）は数える**）。
--
-- ## 🔴 店側の代理予約には適用しない
--
-- 予約回数の制限（GB003）と同じ思想。`auth.uid() = NEW.user_id` の自己予約だけを見る。
-- 「今月はもう上限だけど、事情があるので入れてあげる」を店ができる。
--
-- ## SQLSTATE は GB004
--
--   GB001 担当が満枠 / GB002 担当がシフト外 / GB003 時間帯の回数上限
--   GB004 プランの回数上限（お客様への案内が「今サイクルはもう取れない」で別物）
-- ============================================================================

COMMENT ON COLUMN public.tenant_plans.allow_overflow IS
  '上限（max_sessions）を超えた予約を許すか。true（既定）= 今までどおり超過できる。'
  'false = guard_booking_plan_limit が GB004 で拒否し、超過によるサイクルの自動ロールも止まる。';

-- ----------------------------------------------------------------------------
-- サイクル窓の算出（クライアントの getCycleWindow と同じ規則）
-- ----------------------------------------------------------------------------
-- 返す end は**排他的上限**（応当日の翌日）。応当日そのものは前サイクルに含める。
CREATE OR REPLACE FUNCTION public.plan_cycle_window(
  p_cycle_start DATE,
  p_target DATE,
  p_cycle_months INT
)
RETURNS TABLE (window_start DATE, window_end DATE)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  v_m     INT := GREATEST(COALESCE(p_cycle_months, 1), 1);
  v_start DATE := p_cycle_start;
  v_i     INT := 0;
BEGIN
  -- 起算日より前は最初のサイクルを返す（架空の「前回」を作らない）
  IF p_target < p_cycle_start THEN
    RETURN QUERY SELECT p_cycle_start, (p_cycle_start + make_interval(months => v_m))::date + 1;
    RETURN;
  END IF;

  -- 応当日が target より「厳密に前」のときだけ次サイクルへ進む
  WHILE (v_start + make_interval(months => v_m))::date < p_target LOOP
    v_start := (v_start + make_interval(months => v_m))::date + 1;
    v_i := v_i + 1;
    EXIT WHEN v_i > 600;   -- 起算日が極端に古い行での暴走止め（50年ぶん）
  END LOOP;

  RETURN QUERY SELECT v_start, (v_start + make_interval(months => v_m))::date + 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.plan_cycle_window(DATE, DATE, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_cycle_window(DATE, DATE, INT) TO authenticated;

-- ----------------------------------------------------------------------------
-- トリガー: プランの回数上限（GB004）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_booking_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor      UUID;
  v_plan       TEXT;
  v_cycle_start DATE;
  v_grace_on   BOOLEAN;
  v_max        INT;
  v_months     INT;
  v_grace      INT;
  v_allow      BOOLEAN;
  v_target     DATE;
  v_ws         DATE;
  v_we         DATE;
  v_prev_ws    DATE;
  v_prev_we    DATE;
  v_prev_count INT;
  v_capacity   INT;
  v_tail_end   DATE;
  v_tail       INT;
  v_lent       INT := 0;
  v_in_window  INT;
  v_used       INT;
BEGIN
  -- 🔴 お客様が自分で取る予約だけを見る（代理・サービスロールは店の裁量）
  v_actor := auth.uid();
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 日時が変わらない UPDATE は見ない。'キャンセル済み' からの復活だけは例外
  -- （GB003 と同じ理由: キャンセル行を置いて別を取り、あとで復活させる抜け道を塞ぐ）
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  -- お客様の契約（表示側 PlanUsageCard と同じ出どころ）
  SELECT p.plan, p.cycle_start_date, p.grace_enabled
    INTO v_plan, v_cycle_start, v_grace_on
    FROM public.profiles p
   WHERE p.user_id = NEW.user_id;

  -- 起算日が無い＝プラン未確定。表示側も UNCONFIGURED でカードを出さないので、判定しない
  IF v_plan IS NULL OR v_cycle_start IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tp.max_sessions, tp.cycle_months, tp.grace_days, tp.allow_overflow
    INTO v_max, v_months, v_grace, v_allow
    FROM public.tenant_plans tp
   WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = v_plan
   LIMIT 1;

  -- 🔴 allow_overflow が true / NULL（既定）なら何もしない＝今までどおり。
  --    プラン行が無い（旧データ互換の名称推定）ときも強制しない。
  IF v_allow IS DISTINCT FROM false THEN
    RETURN NEW;
  END IF;
  -- 通い放題（max_sessions NULL）と 0 以下は上限なし
  IF v_max IS NULL OR v_max <= 0 THEN
    RETURN NEW;
  END IF;

  v_months := GREATEST(COALESCE(v_months, 1), 1);
  v_grace  := GREATEST(COALESCE(v_grace, 0), 0);
  -- 猶予OFFのお客様には猶予を適用しない（PlanUsageCard の graceEnabled === false と同じ）
  IF v_grace_on IS false THEN
    v_grace := 0;
  END IF;

  -- 同一人物の同時リクエストで上限をすり抜けるレースを塞ぐ（GB003 と同じ）
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || NEW.user_id::text || 'plan'));

  v_target := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date;
  SELECT w.window_start, w.window_end INTO v_ws, v_we
    FROM public.plan_cycle_window(v_cycle_start, v_target, v_months) w;

  -- 猶予の繰入（graceLentToPrevCount と同じ）
  IF v_grace > 0 AND v_ws > v_cycle_start THEN
    SELECT w.window_start, w.window_end INTO v_prev_ws, v_prev_we
      FROM public.plan_cycle_window(v_cycle_start, v_ws - 1, v_months) w;

    SELECT count(*) INTO v_prev_count
      FROM public.bookings b
     WHERE b.tenant_id = NEW.tenant_id
       AND b.user_id   = NEW.user_id
       AND b.id IS DISTINCT FROM NEW.id
       AND b.status <> 'キャンセル済み'
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date >= v_prev_ws
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date <  v_ws;

    v_capacity := v_max - v_prev_count;
    IF v_capacity > 0 THEN
      v_tail_end := LEAST(v_ws + v_grace, v_we);
      SELECT count(*) INTO v_tail
        FROM public.bookings b
       WHERE b.tenant_id = NEW.tenant_id
         AND b.user_id   = NEW.user_id
         AND b.id IS DISTINCT FROM NEW.id
         AND b.status <> 'キャンセル済み'
         AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date >= v_ws
         AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date <  v_tail_end;
      v_lent := LEAST(v_capacity, v_tail);
    END IF;
  END IF;

  SELECT count(*) INTO v_in_window
    FROM public.bookings b
   WHERE b.tenant_id = NEW.tenant_id
     AND b.user_id   = NEW.user_id
     AND b.id IS DISTINCT FROM NEW.id
     AND b.status <> 'キャンセル済み'
     AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date >= v_ws
     AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date <  v_we;

  v_used := GREATEST(v_in_window - v_lent, 0);

  IF v_used >= v_max THEN
    RAISE EXCEPTION 'ご契約プランの回数の上限に達しています'
      USING ERRCODE = 'GB004';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_booking_plan_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_plan_limit ON public.bookings;
CREATE TRIGGER trg_guard_booking_plan_limit
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_plan_limit();
