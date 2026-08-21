-- ============================================================================
-- 受付しない時間帯（booking_blocked_windows）
-- ============================================================================
--
-- 実店舗（Salute御所南）の要望（2026-08-21）:
-- 平日の夜は 60分＋間隔15分で実質1〜2枠しか取れない。誰かが 19:00 に取ると
-- その1件が「前は早すぎる」「後は遅すぎる」の間を独占して夜が1枠に潰れる。
-- **開始時刻を 18:15 と 19:30 に揃えれば**、18:15の回（〜19:15＋間隔15分）の直後に
-- 19:30の回が始まり、隙間ゼロで夜が必ず2枠になる。
--
-- そこで「**この2つの時刻の間に始まる予約を受け付けない**」帯を店が置けるようにする。
--
-- ## 🔴 両端は含まない（開区間 (start, end)）
--
-- start_time / end_time **ちょうどに始まる予約は受け付ける**。両端こそが
-- 「残したい2枠」そのものだから（18:15〜19:30 の帯 → 18:30〜19:15 開始を塞ぎ、
-- 18:15 開始と 19:30 開始は取れる）。ここが閉区間だと、店は残したい枠自体を
-- 塞いでしまう。時間帯の区間規則は機能ごとに意味で使い分けている:
--
--   容量の帯（booking_capacity_windows） … [start, end) 半開。スタッフが居る期間
--   回数の制限（booking_frequency_limits）… [start, end] 閉区間。制限する開始時刻の範囲
--   受付しない帯（この表）               … (start, end) 開区間。残す2枠の「間」
--
-- ## 🔴 お客様の自己予約だけに効く（GB003/GB004 と同じ非対称）
--
-- トリガーは auth.uid() = NEW.user_id の自己予約だけを見る。店側の代理予約と
-- サービスロールは素通し（事情のある方を帯の中に入れてあげるのは店の裁量）。
-- 体験・ドロップイン（trial_bookings・ゲスト）にも付けない（GB003 と同じ判断。
-- 数える主体も会員概念も無い。帯の中に体験が入る事故が実際に問題になったら、
-- そのとき trial 側の付与を検討する）。
--
-- ## 🔴 免除（booking_frequency_limits.exempt）は塞ぐ帯より強い
--
-- 「免除は制限より強い」の原則をここにも通す。免除行（閉区間）に当てはまる
-- お客様は帯の中でも予約できる（リハビリで 18:30 にしか来られない方を店が通せる）。
--
-- ## 旧アプリとの互換のため booking_frequency_limits に相乗りしない
--
-- 「回数0回まで」として既存の表に載せる案は、公開済みのクライアント（閉区間で
-- 判定する）が**残したい両端の枠までグレーにしてしまう**。別の表なら旧アプリは
-- 読まない＝画面は今までどおりで、DB のトリガーだけが塞ぐ（押すとエラー）。
-- 新しいアプリは表を読んで「受付外」表示にする。
--
-- ## SQLSTATE は GB006
--
-- GB003（回数上限）と混ぜない。案内が違う（上限＝別の時間帯なら取れる／
-- 受付外＝この時間帯はそもそも受け付けていない。空き待ちしても取れない）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_blocked_windows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- 0=日 … 6=土（JS の Date.getDay() / Postgres の EXTRACT(DOW) と同じ数え方）
  weekdays    INTEGER[] NOT NULL,
  start_time  TEXT NOT NULL DEFAULT '18:15',
  end_time    TEXT NOT NULL DEFAULT '19:30',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT booking_blocked_windows_start_time_check
    CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT booking_blocked_windows_end_time_check
    CHECK (end_time ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  -- ゼロ埋め "HH:MM" は辞書順＝時刻順なので文字列比較で正しい
  CONSTRAINT booking_blocked_windows_range
    CHECK (end_time > start_time),
  -- ⚠️ array_length('{}',1) は NULL で CHECK を素通りする。cardinality を使う
  CONSTRAINT booking_blocked_windows_weekdays_check
    CHECK (cardinality(weekdays) >= 1 AND weekdays <@ ARRAY[0,1,2,3,4,5,6])
);

COMMENT ON TABLE public.booking_blocked_windows IS
  '受付しない時間帯。「start と end の**間**に始まる自己予約を受け付けない」'
  '（両端ちょうどの開始は受け付ける＝残したい2枠）。店側の代理予約には効かない。'
  '免除（booking_frequency_limits.exempt）はこの帯より強い。';

CREATE INDEX IF NOT EXISTS idx_booking_blocked_windows_tenant
  ON public.booking_blocked_windows (tenant_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.booking_blocked_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.booking_blocked_windows;
CREATE POLICY tenant_isolation ON public.booking_blocked_windows AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 読み: ジムの会員全員（お客様の予約画面が枠を「受付外」表示にするため）。
-- 個人情報を含まないジム全体の設定なので、制限ルールのような対象者の絞りは無い。
DROP POLICY IF EXISTS booking_blocked_windows_select ON public.booking_blocked_windows;
CREATE POLICY booking_blocked_windows_select ON public.booking_blocked_windows
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

-- 書けるのは店側（owner / trainer）だけ。
DROP POLICY IF EXISTS booking_blocked_windows_write ON public.booking_blocked_windows;
CREATE POLICY booking_blocked_windows_write ON public.booking_blocked_windows
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_blocked_windows_update ON public.booking_blocked_windows;
CREATE POLICY booking_blocked_windows_update ON public.booking_blocked_windows
  FOR UPDATE TO authenticated
  USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_blocked_windows_delete ON public.booking_blocked_windows;
CREATE POLICY booking_blocked_windows_delete ON public.booking_blocked_windows
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

-- 未ログインには見せない（体験・ドロップインには効かせない＝読む必要が無い）
REVOKE ALL ON public.booking_blocked_windows FROM anon;

-- updated_at を自動で進める
CREATE OR REPLACE FUNCTION public.touch_booking_blocked_windows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_booking_blocked_windows ON public.booking_blocked_windows;
CREATE TRIGGER trg_touch_booking_blocked_windows
  BEFORE UPDATE ON public.booking_blocked_windows
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_booking_blocked_windows();

-- ----------------------------------------------------------------------------
-- トリガー: 受付しない時間帯（GB006）
-- ----------------------------------------------------------------------------
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
    RAISE EXCEPTION 'この時間帯はご予約を受け付けていません'
      USING ERRCODE = 'GB006';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_booking_blocked_window() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_blocked_window ON public.bookings;
CREATE TRIGGER trg_guard_booking_blocked_window
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_blocked_window();

-- ----------------------------------------------------------------------------
-- delete_my_gym に booking_blocked_windows を足す
-- ----------------------------------------------------------------------------
-- ⚠️ この関数は**1回の定義に全テーブルを入れる**こと（20260820030000 の注意書き）。
--    以下は 20260821030000 の定義に booking_blocked_windows の1行を足したもの。
--    （最初 20260821020000 から写して booking_capacity_windows の DELETE を落とし、
--      見張りテストに捕まった。**必ず直前の定義から写す**こと。）

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
  --    退会・休会（status が active 以外）は数えない＝「もう誰も使っていない」なら閉じられる。
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
  DELETE FROM public.booking_blocked_windows WHERE tenant_id = v_tenant_id;

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
  --    所属だけ外す（残すと、消えたジムを指したままになる）。
  UPDATE public.profiles SET tenant_id = NULL WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenants WHERE id = v_tenant_id;
END;
$$;
