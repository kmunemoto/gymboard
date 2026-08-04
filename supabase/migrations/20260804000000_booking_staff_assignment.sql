-- 予約に「担当スタッフ」を持たせる。
--
-- 背景: トレーナーが複数いるジムでは、お客様が「この人に見てほしい」を指定したい。
-- ジム側も「この予約は誰が担当か」を決めて予定表に出したい。
-- これまで bookings には担当を表す列が無く、予約は「店に1件入った」以上の情報を持てなかった。
--
-- ## キャパシティとの関係（ここが設計の要）
--
-- 既存の tenants.booking_capacity は「同じ時間帯に**店として**受けられる予約の数」
-- （ベッド数・施術者数など。20260801000000_booking_capacity.sql）。
-- **この意味は変えない。** 担当スタッフは、その上に重ねる**追加の制約**として入れる:
--
--   1) 店全体   … 重なる予約が booking_capacity 件に達したら拒否（**従来のまま**）
--   2) 担当者ごと … 同じスタッフに時間の重なる予約は入れられない（**今回追加**）
--
-- staff_user_id が NULL（＝担当なし／指名なし）の予約は 2) の対象外。
-- 既存の予約は全て NULL なので、**このマイグレーション単体では挙動が一切変わらない**。
-- 担当を使いたい店は booking_capacity をスタッフ人数に上げたうえで担当を割り当てる。
-- 「ベッド3台・スタッフ2名」のような店も capacity=3 と担当者制約の重ね合わせで表現できる。
--
-- capacity 側に担当者の人数を自動で反映させない理由: ベッド数とスタッフ数は
-- 一致するとは限らず、自動化すると「設定を変えていないのに受入数が変わる」ことになる。
-- 店が明示的に設定した数を上限として尊重する。

-- ============================================================
-- 1) 列の追加
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS staff_user_id uuid;

COMMENT ON COLUMN public.bookings.staff_user_id IS
  'この予約の担当スタッフ（tenant_members の owner/trainer）。NULL＝指名なし／未割当で、担当者単位の重複チェックの対象外。店全体の同時受入数（tenants.booking_capacity）とは別の制約。';

-- 重複チェックが「同じ日・同じテナント・同じ担当」で引くので、その形の索引を張る。
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_staff_date
  ON public.bookings (tenant_id, staff_user_id, booking_date)
  WHERE staff_user_id IS NOT NULL;

-- ============================================================
-- 2) 担当スタッフの正当性を検証する
-- ============================================================
-- bookings には列単位の GRANT が無く、お客様は自分の予約行を INSERT できる。
-- つまりクライアントから staff_user_id に**任意の uuid** を書ける。
-- 「他店のトレーナー」「存在しないユーザー」「退会済みスタッフ」が担当として
-- 入ると、予定表・通知・重複判定が静かに壊れる（エラーにならないので気づけない）。
-- RLS の WITH CHECK では他テーブル（tenant_members）を見た検証を素直に書けないため、
-- BEFORE INSERT/UPDATE のトリガーで検証する。
--
-- service_role（Edge Function・Salute同期）からも同じ検証を通す。担当は
-- どの経路から入っても「そのテナントの現役スタッフ」でなければならない。
CREATE OR REPLACE FUNCTION public.guard_booking_staff_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_staff uuid;
  v_old_staff uuid;
BEGIN
  v_staff := (to_jsonb(NEW) ->> 'staff_user_id')::uuid;

  IF v_staff IS NULL THEN
    RETURN NEW;
  END IF;

  -- ⚠️ 担当が**変わっていない** UPDATE は検証しない。ここを素通しにしないと、
  -- 「スタッフが辞めた後、その人が担当だった予約を一切さわれなくなる」。
  --   - tenant_members.status は owner/trainer が UPDATE できる（退会処理）。
  --     行の同一性トリガーが止めるのは user_id/tenant_id/role だけで status は変えられる。
  --   - tenant_members の行はオーナーが DELETE ポリシーで直接消せる
  --     （remove_staff_member を通さない経路。20260803120000）。
  -- どちらの場合も EXISTS が false になり、キャンセルもメモ追記も
  -- 「選択された担当者はこのジムのスタッフではありません」で落ちるようになる。
  -- このガードの目的は**不正な書き込みを止めること**であって、
  -- 過去の行を後から無効化することではない。
  IF TG_OP = 'UPDATE' THEN
    v_old_staff := (to_jsonb(OLD) ->> 'staff_user_id')::uuid;
    IF v_staff IS NOT DISTINCT FROM v_old_staff THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION '担当スタッフを設定するにはジムの指定が必要です'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = NEW.tenant_id
      AND tm.user_id = v_staff
      AND tm.role IN ('owner', 'trainer')
      AND tm.status = 'active'
  ) THEN
    RAISE EXCEPTION '選択された担当者はこのジムのスタッフではありません'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_booking_staff_assignment ON public.bookings;
CREATE TRIGGER trg_guard_booking_staff_assignment
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_staff_assignment();

-- ============================================================
-- 3) 担当を後から変えるときも二重予約を作らせない
-- ============================================================
-- 既存の prevent_booking_overlap は **BEFORE INSERT のみ**（予約の変更は
-- 「新しい枠を作ってから古い枠を消す」で実現しているため、UPDATE は見ていない）。
-- その方針自体は変えないが、担当だけを差し替える UPDATE は今回新設する導線なので、
-- ここだけは「その担当が同じ時間帯に別の予約を持っていないか」を確認する。
-- 確認しないと、ジム側の「担当を変更」操作で1人に2件を割り当てられてしまう。
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
  new_end := NEW.booking_date + make_interval(mins => new_session_min + COALESCE(buffer_min, 15));

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
          COALESCE(tp.slot_duration_minutes, tenant_session_min, 60) + COALESCE(buffer_min, 15))
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

DROP TRIGGER IF EXISTS trg_guard_booking_staff_reassign ON public.bookings;
CREATE TRIGGER trg_guard_booking_staff_reassign
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_staff_reassign();

-- ============================================================
-- 4) 重複防止トリガー: 担当者単位のチェックを追加
-- ============================================================
-- 20260801000000_booking_capacity.sql からの差分は「担当者ごとの重なり件数」だけ。
-- 店全体の判定（blocked_count / overlap_count）は一切変えていない。
--
-- ⚠️ この関数は bookings と trial_bookings の**両方**のトリガーから呼ばれる
--    （prevent_booking_overlap / prevent_trial_booking_overlap）。
--    trial_bookings に staff_user_id 列は無いので、`NEW.staff_user_id` と直接書くと
--    体験予約の登録が実行時エラーで落ちる。既存の `source` と同じく
--    `to_jsonb(NEW) ->> ...` で読む（列が無ければ NULL になる）。
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
  new_footprint interval;
  new_staff uuid;
BEGIN
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  new_staff := (to_jsonb(NEW) ->> 'staff_user_id')::uuid;

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes, t.booking_capacity
    INTO buffer_min, tenant_session_min, capacity_limit
  FROM public.tenants t WHERE t.id = NEW.tenant_id;
  -- テナントが取れない場合も従来どおり「同時1件」に倒す
  capacity_limit := GREATEST(COALESCE(capacity_limit, 1), 1);

  SELECT tp.slot_duration_minutes INTO new_session_min
  FROM public.tenant_plans tp
  WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type
  LIMIT 1;
  new_session_min := COALESCE(new_session_min, tenant_session_min, 60);

  new_footprint := make_interval(mins => new_session_min + COALESCE(buffer_min, 15));
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
    SELECT 'booking' AS kind,
           b.booking_date AS start_at,
           b.booking_date + make_interval(mins =>
             COALESCE(tp.slot_duration_minutes, tenant_session_min, 60) + COALESCE(buffer_min, 15)
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

-- ============================================================
-- 5) 埋まり枠取得RPC: 担当スタッフも返す
-- ============================================================
-- クライアントが「この担当を選んだときの空き枠」を描くのに必要。
-- 返す型が変わるので DROP してから作り直す（CREATE OR REPLACE では列を足せない）。
-- 体験予約・ブロック枠は担当を持たないので NULL を返す。
-- 個人を特定できる情報は増えない（tenant_members の SELECT RLS で、同じテナントの
-- メンバーはもともとスタッフの一覧を読める）。
DROP FUNCTION IF EXISTS public.get_tenant_booked_slots(uuid, date, date);
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
           COALESCE(tp.slot_duration_minutes, tenant_session_min, 60) + COALESCE(buffer_min, 15)
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
