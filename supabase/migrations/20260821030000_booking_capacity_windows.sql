-- ============================================================================
-- 時間帯別の同時受け入れ数（booking_capacity_windows）
-- ============================================================================
--
-- `tenants.booking_capacity` は「同じ時間帯に店として受けられる予約の数」を
-- **1つの値**で持っている（ベッド数・施術者数）。しかし実際の店は
-- **時間帯によって受けられる数が変わる**:
--
--   平日の昼   … スタッフ2人 → 同時2件
--   平日の夜   … 1人で回す   → 同時1件
--   土曜の午前 … 応援あり     → 同時3件
--
-- 予約回数の制限（`booking_frequency_limits`、GB003）が「**お一人が**取りすぎるのを
-- 防ぐ」ものなのに対し、これは「**その時間の受け入れ枠そのもの**を絞る」もの。
-- 目的が違うので別テーブルにする（1つの表に混ぜると、行を見ても
-- 「誰への制限か / 店の容量か」が区別できなくなる）。
--
-- ## 解決の順序
--
--   1. 予約の**開始時刻**に当てはまる有効な帯を探す
--   2. 当てはまる帯があれば、その中の**最小**の capacity を採る
--   3. 1つも当てはまらなければ `tenants.booking_capacity`（従来どおり）
--
-- 🔴 **複数マッチは最小値**。「平日は2件」と「金曜の夜は1件」が重なったら1件。
-- 予約回数の制限が AND（すべて満たす）なのと同じ考え方で、**厳しいほうが勝つ**。
-- 最大値を採ると、絞るつもりで足した帯が既存の帯に負けて効かない、という
-- 「設定したのに効かない」事故になる。
--
-- ## 判定は「予約の開始時刻」が [start, end) に入るか
--
-- 予約回数の制限と同じ半開区間。18:00-19:00 の帯は 18:00〜18:59 開始に効き、
-- 19:00 開始には効かない。占有の終わりまで見ない（説明できない設定は使われない）。
--
-- ## 体験・ドロップインにも効く
--
-- `check_booking_overlap` は `bookings` と `trial_bookings` の**両方**のトリガー
-- から呼ばれるので、この変更だけで公開ページの予約にも自動的に効く。
-- 公開ページの画面側にも同じ判定を持たせるため、anon から読める RPC
-- `get_tenant_capacity_windows` を用意する（`get_tenant_booking_questions` と同じ形）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_capacity_windows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- 0=日 … 6=土（JS の Date.getDay() / Postgres の EXTRACT(DOW) と同じ数え方）
  weekdays    INTEGER[] NOT NULL,
  start_time  TEXT NOT NULL DEFAULT '00:00',
  end_time    TEXT NOT NULL DEFAULT '24:00',
  -- この帯で同時に受けられる予約の数
  capacity    INTEGER NOT NULL DEFAULT 1,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 開始側に "24:00" は許さない（businessHours.ts / 他の設定表と同じ規則）
  CONSTRAINT booking_capacity_windows_start_time_check
    CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- 終了側だけ終端専用の "24:00" を許す
  CONSTRAINT booking_capacity_windows_end_time_check
    CHECK (end_time ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  -- ゼロ埋め "HH:MM" は辞書順＝時刻順なので文字列比較で正しい
  CONSTRAINT booking_capacity_windows_range
    CHECK (end_time > start_time),
  -- 0 を許さない。「その帯は受け付けない」は営業時間・定休日で表すもので、
  -- 容量 0 で表すと「空き0件」と「営業していない」が画面上で区別できなくなる。
  CONSTRAINT booking_capacity_windows_capacity_check
    CHECK (capacity >= 1 AND capacity <= 99),
  -- ⚠️ array_length('{}', 1) は NULL を返し「NULL >= 1」で CHECK を素通りする。
  --    空配列で 0 を返す cardinality を使うこと（booking_frequency_limits で踏んだ）。
  CONSTRAINT booking_capacity_windows_weekdays_check
    CHECK (cardinality(weekdays) >= 1 AND weekdays <@ ARRAY[0,1,2,3,4,5,6])
);

COMMENT ON TABLE public.booking_capacity_windows IS
  '時間帯別の同時受け入れ数。この曜日×時間帯は capacity 件まで同時に受ける。'
  '当てはまる帯が無ければ tenants.booking_capacity。複数当てはまるときは最小値（厳しいほうが勝つ）。';

CREATE INDEX IF NOT EXISTS idx_booking_capacity_windows_tenant
  ON public.booking_capacity_windows (tenant_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.booking_capacity_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.booking_capacity_windows;
CREATE POLICY tenant_isolation ON public.booking_capacity_windows AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 読みは同じジムの人全員（お客様の予約画面が枠の埋まり具合を判定するのに要る）。
-- 店の容量は「誰への制限か」を含まないので、個人情報の問題は無い
-- （booking_frequency_limits の個別ルールとはそこが違う）。
DROP POLICY IF EXISTS booking_capacity_windows_select ON public.booking_capacity_windows;
CREATE POLICY booking_capacity_windows_select ON public.booking_capacity_windows
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS booking_capacity_windows_write ON public.booking_capacity_windows;
CREATE POLICY booking_capacity_windows_write ON public.booking_capacity_windows
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_capacity_windows_update ON public.booking_capacity_windows;
CREATE POLICY booking_capacity_windows_update ON public.booking_capacity_windows
  FOR UPDATE TO authenticated
  USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_capacity_windows_delete ON public.booking_capacity_windows;
CREATE POLICY booking_capacity_windows_delete ON public.booking_capacity_windows
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

-- 表への直接読みは anon に開けない。公開ページには下の RPC だけを開ける
-- （2026-08-06 の方針: anon に見せる面は関数の戻り列ちょうどにする）。
REVOKE ALL ON public.booking_capacity_windows FROM anon;

CREATE OR REPLACE FUNCTION public.touch_booking_capacity_windows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_booking_capacity_windows ON public.booking_capacity_windows;
CREATE TRIGGER trg_touch_booking_capacity_windows
  BEFORE UPDATE ON public.booking_capacity_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_booking_capacity_windows();

-- ----------------------------------------------------------------------------
-- 容量の解決（1箇所にまとめる）
-- ----------------------------------------------------------------------------
-- check_booking_overlap から呼ぶ。関数に切り出しておくと、
-- 「トリガーだけ直して RPC を直し忘れる」が起きにくい。
CREATE OR REPLACE FUNCTION public.resolve_booking_capacity(
  p_tenant_id UUID,
  p_booking_date TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_jst      TIMESTAMP;
  v_dow      INT;
  v_min      INT;
  v_window   INT;
  v_fallback INT;
BEGIN
  SELECT t.booking_capacity INTO v_fallback
    FROM public.tenants t WHERE t.id = p_tenant_id;
  -- テナントが取れない場合も従来どおり「同時1件」に倒す
  v_fallback := GREATEST(COALESCE(v_fallback, 1), 1);

  IF p_tenant_id IS NULL OR p_booking_date IS NULL THEN
    RETURN v_fallback;
  END IF;

  v_jst := (p_booking_date AT TIME ZONE 'Asia/Tokyo');
  v_dow := EXTRACT(DOW FROM v_jst)::int;
  v_min := EXTRACT(HOUR FROM v_jst)::int * 60 + EXTRACT(MINUTE FROM v_jst)::int;

  -- 🔴 複数マッチは最小値（厳しいほうが勝つ）。
  SELECT min(w.capacity) INTO v_window
    FROM public.booking_capacity_windows w
   WHERE w.tenant_id = p_tenant_id
     AND w.enabled
     AND v_dow = ANY (w.weekdays)
     AND v_min >= (split_part(w.start_time, ':', 1)::int * 60 + split_part(w.start_time, ':', 2)::int)
     AND v_min <  (split_part(w.end_time,   ':', 1)::int * 60 + split_part(w.end_time,   ':', 2)::int);

  -- 帯が無ければ店の既定値。あってもゼロ以下には落とさない。
  RETURN GREATEST(COALESCE(v_window, v_fallback), 1);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_booking_capacity(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_booking_capacity(UUID, TIMESTAMPTZ) TO authenticated;

-- 公開ページ（体験・ドロップイン）が枠の埋まり具合を判定するのに帯が要る。
-- 表そのものは開けず、この関数の戻り列だけを見せる。
CREATE OR REPLACE FUNCTION public.get_tenant_capacity_windows(p_tenant_id UUID)
RETURNS TABLE (
  weekdays INTEGER[],
  start_time TEXT,
  end_time TEXT,
  capacity INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT w.weekdays, w.start_time, w.end_time, w.capacity
    FROM public.booking_capacity_windows w
    JOIN public.tenants t ON t.id = w.tenant_id
   WHERE w.tenant_id = p_tenant_id
     AND w.enabled
     -- 休止・解約した店の設定は公開しない（get_tenant_public と同じ条件）
     AND t.status IN ('active', 'trial');
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_capacity_windows(UUID) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- check_booking_overlap を「帯を見る」ように作り直す
-- ----------------------------------------------------------------------------
-- ⚠️ 変更は capacity_limit の解決 **1箇所だけ**。ほかは
--    20260804000000_booking_staff_assignment.sql の定義のまま
--    （満枠判定の主目的に別の理由を混ぜない、という既存方針）。
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

-- ----------------------------------------------------------------------------
-- delete_my_gym に booking_capacity_windows を足す
-- ----------------------------------------------------------------------------
-- ⚠️ この関数は**1回の定義に全テーブルを入れる**こと。分けて足すと最後の定義しか
--    残らない（`src/test/bookingLimits.test.ts` が最後の定義を見張っている）。
CREATE OR REPLACE FUNCTION public.delete_my_gym()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_tenant_id UUID;
  v_others    INT;
  v_owned     INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 🔴 引き継ぎと同じ理由で、複数所有なら選ばずに落とす（消す対象を取り違えない）。
  -- ⚠️ min(uuid) は存在しない（本番検証で踏んだ）。array_agg で1件目を取る。
  SELECT count(*), (array_agg(tenant_id))[1] INTO v_owned, v_tenant_id
    FROM public.tenant_members
   WHERE user_id = v_uid AND role = 'owner' AND status = 'active';

  IF v_owned = 0 THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_owned > 1 THEN
    RAISE EXCEPTION 'ambiguous_tenant:%', v_owned USING ERRCODE = 'check_violation';
  END IF;

  -- 🔴 自分以外の在籍者がいたら閉じさせない。
  SELECT count(*) INTO v_others
    FROM public.tenant_members
   WHERE tenant_id = v_tenant_id
     AND user_id <> v_uid
     AND status = 'active';

  IF v_others > 0 THEN
    RAISE EXCEPTION 'members_remain:%', v_others USING ERRCODE = 'check_violation';
  END IF;

  -- 外側 → 内側の順に落とす
  DELETE FROM public.announcement_reads
   WHERE announcement_id IN (SELECT id FROM public.announcements WHERE tenant_id = v_tenant_id);

  DELETE FROM public.member_agreements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_reactions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.messages            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_templates   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.operator_feedback   WHERE tenant_id = v_tenant_id;

  DELETE FROM public.workouts            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercise_id_map     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercises           WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_muscle_groups WHERE tenant_id = v_tenant_id;

  DELETE FROM public.booking_waitlist    WHERE tenant_id = v_tenant_id;
  DELETE FROM public.bookings            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.blocked_slots       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.trial_bookings      WHERE tenant_id = v_tenant_id;
  -- 予約の付随設定。予約行を消した後に消す（参照はしていないが読み順を揃える）。
  DELETE FROM public.booking_questions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.staff_schedules     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_frequency_limits WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_capacity_windows WHERE tenant_id = v_tenant_id;

  DELETE FROM public.member_payments     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.counseling_responses WHERE tenant_id = v_tenant_id;
  DELETE FROM public.monthly_reports     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.progress_photos     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.user_measurements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.meals               WHERE tenant_id = v_tenant_id;
  DELETE FROM public.notification_settings WHERE tenant_id = v_tenant_id;
  DELETE FROM public.announcements       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.migration_user_map  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_plans        WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenant_members      WHERE tenant_id = v_tenant_id;

  -- 🔴 profiles は**消さない**。ジムを閉じてもアカウントは本人のもの。
  UPDATE public.profiles SET tenant_id = NULL WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenants WHERE id = v_tenant_id;
END;
$$;
