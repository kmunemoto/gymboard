-- ============================================================================
-- 予約に付けたオプションの時間を「同じ1回のセッション」として占有に足す
-- ============================================================================
--
-- 第1段（20260902000000）で店がオプションを定義できるようにした。ここが第2段で、
-- 実際に予約へ結び付け、**予定表の占有に反映する**。
--
-- ## 🔴 間（準備時間）は1回だけ
--
--   1枠60分 ＋ オプション30分 ＋ 次のお客様までの間15分 ＝ 105分
--
-- 「60 + 15 + 30 + 15 = 120」ではない。宗本さんの明言:
-- 「トレーニング時間とストレッチの間にもちろん15分は開けません。
--   一つのセッションの時間として扱います」。
-- 間を2回取ると、実際には空いている15分が予定表から静かに消える。
--
-- ## 直す箇所（占有を計算しているところは全部で4つ）
--
--   1. check_booking_overlap … これから入れる予約の footprint      ← 直す
--   2. check_booking_overlap … 既存の bookings の footprint        ← 直す
--   3. check_booking_overlap … 既存の trial_bookings の footprint  ← **直さない**
--   4. guard_booking_staff_reassign … 担当差し替え時の両側          ← 直す
--   ＋ get_tenant_booked_slots の bookings 側（画面が見る空き枠）   ← 直す
--
-- 3 を直さない理由: 体験・ドロップインは `trial_bookings` にあり、オプションを
-- 持たない（この版では付けられない）。列が無いので足しようがないし、足す必要も無い。
--
-- ## 🔴 NEW.option_minutes と直接書いてはいけない
--
-- `check_booking_overlap` は **bookings と trial_bookings の両方**のトリガーから
-- 呼ばれる（prevent_booking_overlap / prevent_trial_booking_overlap、
-- 20260411101056 で作られたきり変えていない）。`trial_bookings` に
-- `option_minutes` 列は無いので、直接書くと
--
--     record "new" has no field "option_minutes"
--
-- で**体験予約の登録だけが実行時に落ちる**。しかもこの文言は trial-book の
-- 「この時間帯」判定にも /overlap/i にも当たらないので、お客様には
-- 「サーバーで問題が発生しました」としか出ず、原因に辿り着けない。
-- 既存の `source` / `staff_user_id` と同じく `to_jsonb(NEW) ->> ...` で読む
-- （列が無ければ NULL → COALESCE で 0）。同じ穴を 2026-08-04 に一度踏んでいる。
--
-- ## 上限判定（回数・1日の人数・容量の帯）は触らない
--
-- どれも「件数」または「開始時刻」で判定していて、長さを見ていない。
-- オプションは長さを変えるだけなので、GB003 / GB006 / GB007 /
-- resolve_booking_capacity はそのままで正しい。
--
-- ## UPDATE では伸びない
--
-- 重複判定は **BEFORE INSERT のみ**（予約の変更は「新しい枠を作ってから古い枠を
-- 消す」で実現しているため。20260804000000 の方針）。したがって
-- 「あとからオプションを足して占有だけ伸ばす」経路は作らないこと。
-- 作るなら、その UPDATE を見るトリガーを同時に足す必要がある。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 予約に列を足す
-- ----------------------------------------------------------------------------
-- 🔴 NOT NULL DEFAULT 0。古いアプリ（インストール済みのネイティブは束ねた JS で
--    動くので、この列を知らないまま何週間も INSERT してくる）は列を送ってこないが、
--    既定 0 で「オプション無し」になり、従来とまったく同じ占有になる。
--    nullable にすると COALESCE の書き漏らしが即バグになるので NOT NULL にする。
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS option_minutes INTEGER NOT NULL DEFAULT 0;

-- 上限は booking_options.duration_minutes の上限（180分）に合わせる。
-- 複数付けられるので合計はもう少し伸びうるが、1日の営業時間を超える値は
-- 入力ミス以外にありえないため 480分（8時間）で頭を止める。
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_option_minutes_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_option_minutes_check
  CHECK (option_minutes >= 0 AND option_minutes <= 480);

-- 何を付けたかの控え。`booking_options` の行を後から直しても・消しても、
-- 過去の予約から「何を、いくらで付けたか」が辿れるようにする
-- （`bookings.custom_answers` と同じ考え方）。形は
--   [{"id": "...", "name": "ストレッチ", "duration_minutes": 30, "price_yen": 3000}]
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_options JSONB;

COMMENT ON COLUMN public.bookings.option_minutes IS
  '付けたオプションの合計時間（分）。1枠 + これ + 間 が予定表の占有。間は1回だけ。';
COMMENT ON COLUMN public.bookings.booking_options IS
  '予約時に選ばれたオプションの控え（id/name/duration_minutes/price_yen の配列）。'
  'booking_options 表を後から直しても過去の予約の内容が変わらないようにするためのスナップショット。';

-- ----------------------------------------------------------------------------
-- 2) 重複判定にオプションの分を足す
-- ----------------------------------------------------------------------------
-- ⚠️ 20260821030000_booking_capacity_windows.sql の定義から**機械的に写し**、
--    footprint の2箇所だけを変えてある。ほかは1文字も変えていない。
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
  blocked_count integer;
  staff_conflict_count integer;
  buffer_min integer;
  tenant_session_min integer;
  capacity_limit integer;
  new_session_min integer;
  new_option_min integer;
  new_footprint interval;
  new_staff uuid;
BEGIN
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  new_staff := (to_jsonb(NEW) ->> 'staff_user_id')::uuid;

  -- 🔴 trial_bookings にはこの列が無い。直接 NEW.option_minutes と書くと
  --    体験予約の登録が実行時に落ちる（ファイル冒頭の説明を読むこと）。
  new_option_min := GREATEST(COALESCE((to_jsonb(NEW) ->> 'option_minutes')::int, 0), 0);

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes
    INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = NEW.tenant_id;

  -- 🔴 同時受け入れ数は時間帯で変わりうる。帯が無ければ tenants.booking_capacity
  --    （テナントが取れない場合も含め、必ず 1 以上に倒る）。
  capacity_limit := public.resolve_booking_capacity(NEW.tenant_id, NEW.booking_date);

  SELECT tp.slot_duration_minutes INTO new_session_min
  FROM public.tenant_plans tp
  WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type
  LIMIT 1;
  new_session_min := COALESCE(new_session_min, tenant_session_min, 60);

  -- 【変更点1/2】1枠 + オプション + 間（間は1回だけ）
  new_footprint := make_interval(mins => new_session_min + new_option_min + COALESCE(buffer_min, 15));
  new_start := NEW.booking_date;
  new_end := NEW.booking_date + new_footprint;

  SELECT
    COUNT(*) FILTER (WHERE existing.kind = 'block'),
    COUNT(*) FILTER (WHERE existing.kind = 'booking'),
    COUNT(*) FILTER (WHERE existing.kind = 'booking'
                       AND new_staff IS NOT NULL
                       AND existing.staff_user_id = new_staff)
  INTO blocked_count, overlap_count, staff_conflict_count
  FROM (
    -- 【変更点2/2】既存の予約側にもオプションの分を足す。
    -- ここを忘れると、60+30 の予約が75分としてしか見えず、ストレッチの最中に
    -- 別のお客様を入れられる（DB が受け入れてしまう＝本物の二重予約）。
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
    -- 体験予約は担当を持たない（公開ページから誰でも入れる枠なので指名の概念が無い）。
    -- 店全体の枠は1件として消費するが、担当者単位の判定には効かない。
    -- 🔴 オプションも持たない。ここに option を足してはいけない（列が無い）。
    SELECT 'booking' AS kind,
           tb.booking_date AS start_at,
           tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_at,
           NULL::uuid AS staff_user_id
    FROM public.trial_bookings tb
    WHERE tb.status != 'キャンセル済み'
      AND tb.id IS DISTINCT FROM NEW.id
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

  -- 文言は据え置き（capacity=1 のとき従来と完全に同じ挙動・同じメッセージになるように）
  IF blocked_count > 0 OR overlap_count >= capacity_limit THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  -- 担当者が埋まっているだけなら、店にはまだ空きがある。
  -- 「他の担当者なら取れる」と分かる文言にする（同じ文言だと選び直せると気づけない）。
  IF staff_conflict_count > 0 THEN
    RAISE EXCEPTION 'この担当者はその時間帯にすでに予約が入っています'
      USING ERRCODE = 'GB001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3) 担当の差し替え（BEFORE UPDATE）にもオプションの分を足す
-- ----------------------------------------------------------------------------
-- 4つめの footprint。ここを忘れると「担当を変更」操作で、
-- どちらかにオプションが付いている2件を1人に割り当てられる。
-- ⚠️ この関数は bookings 専用（trg_guard_booking_staff_reassign は
--    BEFORE UPDATE ON public.bookings）。NEW.option_minutes と直接書いてよい。
CREATE OR REPLACE FUNCTION public.guard_booking_staff_reassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_new_staff uuid;
  v_old_staff uuid;
  buffer_min integer;
  tenant_session_min integer;
  new_session_min integer;
  new_start timestamptz;
  new_end timestamptz;
  conflict_count integer;
BEGIN
  v_new_staff := (to_jsonb(NEW) ->> 'staff_user_id')::uuid;
  v_old_staff := (to_jsonb(OLD) ->> 'staff_user_id')::uuid;

  -- 担当が変わっていない UPDATE（ステータス変更・メモ追記など）は素通し。
  IF v_new_staff IS NULL OR v_new_staff IS NOT DISTINCT FROM v_old_staff THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes
    INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = NEW.tenant_id;

  SELECT tp.slot_duration_minutes INTO new_session_min
  FROM public.tenant_plans tp
  WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type
  LIMIT 1;
  new_session_min := COALESCE(new_session_min, tenant_session_min, 60);

  new_start := NEW.booking_date;
  new_end := NEW.booking_date + make_interval(mins =>
    new_session_min + COALESCE(NEW.option_minutes, 0) + COALESCE(buffer_min, 15));

  SELECT COUNT(*) INTO conflict_count
  FROM public.bookings b
  LEFT JOIN public.tenant_plans tp
    ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
  WHERE b.status != 'キャンセル済み'
    AND b.id IS DISTINCT FROM NEW.id
    AND b.tenant_id = NEW.tenant_id
    AND b.staff_user_id = v_new_staff
    AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date
    AND new_start < b.booking_date + make_interval(mins =>
          COALESCE(tp.slot_duration_minutes, tenant_session_min, 60)
          + COALESCE(b.option_minutes, 0)
          + COALESCE(buffer_min, 15))
    AND b.booking_date < new_end;

  IF conflict_count > 0 THEN
    -- SQLSTATE 'GB001' は「担当者が埋まっている」専用。クライアントは
    -- error.code で「店が満枠」と区別し、「別の担当なら取れる」と案内する
    -- （文言一致で判定すると、業種フォークが文言を変えた瞬間に静かに壊れる）。
    RAISE EXCEPTION 'この担当者はその時間帯にすでに予約が入っています'
      USING ERRCODE = 'GB001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4) 画面が見る「埋まり枠」にもオプションの分を足す
-- ----------------------------------------------------------------------------
-- 🔴 ここを忘れると、上の判定だけが正しくなって画面が古いままになる＝
--    **「空きに見えるのに送信すると断られる」**。しかも再取得しても空きのままなので、
--    お客様は同じ枠を何度も押し続ける。このリポジトリで最も避けたいズレ。
--
-- 戻りの列は変えていないので CREATE OR REPLACE でよい（DROP すると、
-- 貼り替えの一瞬だけ公開の予約ページが落ちる）。
CREATE OR REPLACE FUNCTION public.get_tenant_booked_slots(p_tenant_id uuid, from_date date, to_date date)
RETURNS TABLE(
  booking_date timestamp with time zone,
  end_booking_date timestamp with time zone,
  status text,
  staff_user_id uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  buffer_min integer;
  tenant_session_min integer;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = p_tenant_id;

  RETURN QUERY
  -- 体験・ドロップインはオプションを持たない（従来どおり）。
  SELECT tb.booking_date,
         tb.booking_date + make_interval(mins => COALESCE(tenant_session_min, 60) + COALESCE(buffer_min, 15)) AS end_booking_date,
         tb.status,
         NULL::uuid AS staff_user_id
  FROM public.trial_bookings tb
  WHERE (tb.tenant_id = p_tenant_id OR tb.tenant_id IS NULL)
    AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT b.booking_date,
         b.booking_date + make_interval(mins =>
           COALESCE(tp.slot_duration_minutes, tenant_session_min, 60)
           + COALESCE(b.option_minutes, 0)
           + COALESCE(buffer_min, 15)
         ) AS end_booking_date,
         b.status,
         b.staff_user_id
  FROM public.bookings b
  LEFT JOIN public.tenant_plans tp
    ON tp.tenant_id = b.tenant_id AND tp.plan_name = b.booking_type
  WHERE (b.tenant_id = p_tenant_id OR b.tenant_id IS NULL)
    AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
  UNION ALL
  SELECT bs.blocked_date AS booking_date,
         bs.end_blocked_date AS end_booking_date,
         'ブロック済み' AS status,
         NULL::uuid AS staff_user_id
  FROM public.blocked_slots bs
  WHERE (bs.tenant_id = p_tenant_id OR bs.tenant_id IS NULL)
    AND (bs.blocked_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_booked_slots(uuid, date, date) TO anon, authenticated;
