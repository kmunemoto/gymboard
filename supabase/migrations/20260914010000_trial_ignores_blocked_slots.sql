-- ============================================================================
-- 体験予約だけ「時間ブロック」を無視して受けられるようにする（店ごとON/OFF）
--
-- 2026-09-14 宗本さんの要望:
--   「体験予約はお店のブロックを無視して予約できるように設定できる、
--     オンオフの機能を追加してほしい」→「時間ブロックです」
--
-- ここでいう「時間ブロック」は予定表の `blocked_slots`（画面の言葉で
-- `schedule.blockTime` = 「時間ブロック」）。ジム設定の「受付しない時間帯」
-- （`blocked_windows`）とは**別物**で、そちらは体験予約に元々効いていない。
--
-- ## 🔴 画面だけ直しても1件も入らない（本番で実証済み）
--
-- `trial_bookings` には `prevent_trial_booking_overlap`（BEFORE INSERT）が
-- 生きていて、この `check_booking_overlap()` を呼ぶ。中で `blocked_count > 0`
-- なら無条件で `この時間帯はすでに予約が入っています` を投げる。
-- 実際に本番でブロック枠へ体験予約を INSERT してみたところ、service_role でも
-- P0001 で拒否された（BEGIN … ROLLBACK で確認。残骸なし）。
-- **だから DB とクライアントを同じ PR で直す。**
--
-- ## 🔴 この関数は bookings と共用している
--
-- `prevent_booking_overlap`（`bookings`）も同じ関数を実行する。
-- 緩める分岐は **`TG_TABLE_NAME = 'trial_bookings'` で必ず限定する**。
-- 限定を忘れると、会員の自己予約も店の代理予約も全テナントで
-- ブロック枠を素通りし、二重予約が起きる。
--
-- ## 🔴 ドロップインは対象外（2026-09-14 宗本さんの決定）
--
-- 体験とドロップインは**同じ `trial_bookings`** に入り、`booking_kind` で
-- 区別している。依頼は「体験予約は」なので、`booking_kind = 'trial'` まで絞る。
-- （`booking_kind` は NOT NULL DEFAULT 'trial' なので古い行も安全側に入る。
--   `bookings` にはこの列が無いので、`NEW.booking_kind` と直接書かず
--   `to_jsonb(NEW) ->>` で読む。この関数の既存の作法と同じ）
--
-- ## 何を無視して、何を無視しないか
--
--   無視する   … 時間ブロック（`blocked_slots`）
--   無視しない … 他の予約との重なり（同時受入数）・担当者の重複・営業時間・締切
--
-- 同時受入数はそのまま効く。DB 側の `overlap_count` は `kind = 'booking'` しか
-- 数えていないので、ブロックを無視しても容量判定は汚れない
-- （⚠️ クライアント側は同じ配列で数えているので、そちらは別途 filter が要る）。
-- ============================================================================

-- ── 設定列（既定は false ＝ 現状維持。他ジムの挙動は1ミリも変わらない）──────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_ignores_blocked_slots BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.trial_ignores_blocked_slots IS
  '🔴 true のとき、体験予約（trial_bookings の booking_kind = ''trial''）だけが '
  '予定表の時間ブロック（blocked_slots）を無視して入れられる。既定 false ＝ 現状維持。'
  '会員予約・店の代理予約・ドロップインには効かない。'
  '同時受入数・担当者の重複・営業時間・締切は true でもそのまま効く。';

-- 🔴 migration では誰の値も更新しない。Salute御所南で使うなら本番で個別に入れる
--    （CLAUDE.md: 特定テナント専用の変更を全テナントに適用しない）。

-- ── 重なりチェック（bookings と trial_bookings で共用）────────────────────
-- 本番の現行定義（pg_get_functiondef）をそのまま写し、下記2点だけ足している:
--   1. v_ignore_blocks の宣言と、体験予約に限った読み取り
--   2. 最後の判定を `(NOT v_ignore_blocks AND blocked_count > 0)` にする
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
  -- 🔴 体験予約のときだけ true になりうる。既定 false（安全側）
  v_ignore_blocks boolean := false;
BEGIN
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  new_staff := (to_jsonb(NEW) ->> 'staff_user_id')::uuid;

  -- 🔴 trial_bookings にはこの列が無い。直接 NEW.option_minutes と書くと
  --    体験予約の登録が実行時に落ちる。
  new_option_min := GREATEST(COALESCE((to_jsonb(NEW) ->> 'option_minutes')::int, 0), 0);

  SELECT t.booking_buffer_minutes, t.slot_duration_minutes
    INTO buffer_min, tenant_session_min
  FROM public.tenants t WHERE t.id = NEW.tenant_id;

  -- 🔴 ブロック枠を無視してよいのは「体験予約」だけ。
  --    TG_TABLE_NAME で bookings を必ず除く（この関数は2テーブル共用）。
  --    booking_kind でドロップインも除く（同じテーブルに同居している）。
  --    bookings には booking_kind 列が無いので to_jsonb で読む。
  IF TG_TABLE_NAME = 'trial_bookings'
     AND COALESCE(to_jsonb(NEW) ->> 'booking_kind', 'trial') = 'trial' THEN
    SELECT COALESCE(t.trial_ignores_blocked_slots, false)
      INTO v_ignore_blocks
    FROM public.tenants t WHERE t.id = NEW.tenant_id;
    v_ignore_blocks := COALESCE(v_ignore_blocks, false);
  END IF;

  -- 🔴 同時受け入れ数は時間帯で変わりうる。帯が無ければ tenants.booking_capacity
  --    （テナントが取れない場合も含め、必ず 1 以上に倒る）。
  capacity_limit := public.resolve_booking_capacity(NEW.tenant_id, NEW.booking_date);

  SELECT tp.slot_duration_minutes INTO new_session_min
  FROM public.tenant_plans tp
  WHERE tp.tenant_id = NEW.tenant_id AND tp.plan_name = NEW.booking_type
  LIMIT 1;
  new_session_min := COALESCE(new_session_min, tenant_session_min, 60);

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

  -- 文言は据え置き（capacity=1 のとき従来と完全に同じ挙動・同じメッセージになるように）。
  -- 🔴 v_ignore_blocks が true なのは「体験予約 × booking_kind='trial' ×
  --    テナントが許可」の3つが揃ったときだけ。それ以外はここまでと同じ判定。
  IF (NOT v_ignore_blocks AND blocked_count > 0) OR overlap_count >= capacity_limit THEN
    RAISE EXCEPTION 'この時間帯はすでに予約が入っています';
  END IF;

  IF staff_conflict_count > 0 THEN
    RAISE EXCEPTION 'この担当者はその時間帯にすでに予約が入っています'
      USING ERRCODE = 'GB001';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 公開ページ（/trial）へ設定を届ける ────────────────────────────────────
-- 体験予約ページはログイン不要なので tenants を直接読めない。
-- 返り値の型を変えるので DROP → CREATE → GRANT の3点セット（既存の前例どおり）。
-- ⚠️ DROP すると GRANT も消える。必ず貼り直すこと。
DROP FUNCTION IF EXISTS public.get_tenant_public(uuid);

CREATE OR REPLACE FUNCTION public.get_tenant_public(p_id uuid)
 RETURNS TABLE(
   id uuid, gym_name text, gym_name_short text, address text, logo_url text,
   primary_color text, trial_info_title text, trial_info_body text,
   booking_buffer_minutes integer, slot_duration_minutes integer,
   booking_capacity integer, booking_cutoff_type text, booking_cutoff_hours integer,
   trial_price_yen integer, operating_hours jsonb, booking_window_days integer,
   trial_ignores_blocked_slots boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.id, t.gym_name, t.gym_name_short, t.address, t.logo_url, t.primary_color,
         t.trial_info_title, t.trial_info_body, t.booking_buffer_minutes, t.slot_duration_minutes,
         t.booking_capacity, t.booking_cutoff_type, t.booking_cutoff_hours,
         t.trial_price_yen, t.operating_hours, t.booking_window_days,
         t.trial_ignores_blocked_slots
  FROM public.tenants t
  WHERE t.id = p_id AND t.status IN ('active', 'trial')
  LIMIT 1;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon, authenticated, service_role;
