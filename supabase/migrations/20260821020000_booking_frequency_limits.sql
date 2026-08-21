-- ============================================================================
-- 予約回数の制限（booking_frequency_limits）
-- ============================================================================
--
-- 「平日の 18:00〜19:00 は1週間に1回まで」のように、**混み合う時間帯に
-- お一人が取れる予約の回数**を店が制限できるようにする。
--
-- 実店舗（Salute御所南）で実際に起きた問題:
-- 週2回来る会員が平日夜のピーク帯（18-19時）を週2枠とも取ってしまい、
-- 他の会員がその時間帯を一度も取れない。
--
-- ## ルールの形（1行 = 1ルール）
--
--   曜日の集合 × 時間帯 [start, end) × 期間（週 or 日）× 回数上限
--     × 対象（user_id NULL = 全員 / 非NULL = そのお客様だけ）× enabled
--
-- 汎用にしてあるので、同じ仕組みで次も表現できる:
--   - 「1日に1回まで」        … 全曜日・00:00-24:00・period='day'・max=1
--   - 「全体で週2回まで」      … 全曜日・00:00-24:00・period='week'・max=2
--   - 「土曜午前は週1回まで」  … weekdays=[6]・09:00-12:00・period='week'・max=1
--
-- ## 🔴 店側の代理予約には適用しない
--
-- トリガーは **auth.uid() = NEW.user_id（お客様が自分で取る予約）だけ**を見る。
-- 代理予約（トレーナーが auth.uid() ≠ user_id で入れる）とサービスロール経由
-- （auth.uid() IS NULL。salute_sync 等）は素通しする。
-- 受付開始時期（booking_window）と同じ思想: お客様のセルフサービスを制限するのが
-- 目的で、店が電話で受けて手で入れるぶんは店の裁量。例外は店が作れる。
--
-- ## 判定は「予約の開始時刻」が時間帯に入るか
--
-- [start, end) の半開区間。18:00-19:00 のルールは 18:00〜18:59 開始の予約に効く。
-- 「終わる時刻まで見るか」は考えない（説明できない制限は現場で使われない）。
--
-- ## 期間の数え方
--
--   week: JST の暦週・**月曜始まり**（date_trunc('week') = ISO 週。
--         クライアントも全箇所 weekStartsOn: 1 で統一されている）
--   day:  JST の暦日
--
-- 数える対象は「status <> 'キャンセル済み'」。**'同日キャンセル済み'（消化）は数える**。
-- 満枠判定（check_booking_overlap）と同じ除外規則に揃える。消化はセッションを
-- 使った扱いなので、その週のピーク帯の権利も使ったと数えるのが公平。
--
-- ## 全体ルールと個別ルールの関係は「すべて満たす」
--
-- マッチしたルールを全部評価し、どれか1つでも超えていれば拒否（AND）。
-- 個別ルール＝そのお客様への**追加の**締め付けであって、全体ルールの上書きではない。
-- 「特定のお客様だけ緩める（免除）」は今回は持たない（必要になったら exempt を足す）。
--
-- ## SQLSTATE は GB003
--
-- GB001（担当が満枠 → 別の時間なら取れる）、GB002（担当がシフト外 → 別の担当か
-- 別の曜日）とお客様への案内が違うので分ける。判定は文言一致ではなく error.code
-- （クライアントは src/lib/bookingLimits.ts の isBookingLimitError）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_frequency_limits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- NULL = ジムの全お客様に適用 / 非NULL = そのお客様だけに適用。
  -- FK は張らない（staff_schedules と同じ）。退会でお客様が消えても行は無害に残り、
  -- テナント削除は delete_my_gym の明示 DELETE が拾う。
  user_id     UUID,
  -- 0=日 … 6=土（JS の Date.getDay() / Postgres の EXTRACT(DOW) と同じ数え方）
  weekdays    INTEGER[] NOT NULL,
  start_time  TEXT NOT NULL DEFAULT '00:00',
  end_time    TEXT NOT NULL DEFAULT '24:00',
  period      TEXT NOT NULL DEFAULT 'week',
  max_bookings INTEGER NOT NULL DEFAULT 1,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 開始側に "24:00" は許さない（businessHours.ts / staff_schedules と同じ規則）
  CONSTRAINT booking_frequency_limits_start_time_check
    CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- 終了側だけ終端専用の "24:00" を許す
  CONSTRAINT booking_frequency_limits_end_time_check
    CHECK (end_time ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'),
  -- ゼロ埋め "HH:MM" は辞書順＝時刻順なので文字列比較で正しい
  CONSTRAINT booking_frequency_limits_range
    CHECK (end_time > start_time),
  CONSTRAINT booking_frequency_limits_period_check
    CHECK (period IN ('week', 'day')),
  -- 0 を許さない。「取らせない」は制限ではなく退会・休会の話で、設定ミスで
  -- 全予約が止まる値を持てないようにする（booking_window_days の 0 と同じ思想）
  CONSTRAINT booking_frequency_limits_max_check
    CHECK (max_bookings >= 1 AND max_bookings <= 99),
  -- 曜日は 0-6 のみ・1つ以上（空配列のルールは何にもマッチせず、ただ紛らわしい）。
  -- ⚠️ array_length('{}', 1) は NULL を返し「NULL >= 1」= NULL で CHECK を素通りする。
  --    空配列で 0 を返す cardinality を使うこと（レビューで発覚）。
  CONSTRAINT booking_frequency_limits_weekdays_check
    CHECK (cardinality(weekdays) >= 1 AND weekdays <@ ARRAY[0,1,2,3,4,5,6])
);

COMMENT ON TABLE public.booking_frequency_limits IS
  '予約回数の制限。「この曜日×時間帯は、期間（週/日）に max_bookings 回まで」。'
  'user_id NULL = 全員、非NULL = そのお客様だけ。店側の代理予約には適用されない'
  '（guard_booking_frequency_limit が auth.uid() = user_id の自己予約だけを見る）。';

CREATE INDEX IF NOT EXISTS idx_booking_frequency_limits_tenant
  ON public.booking_frequency_limits (tenant_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.booking_frequency_limits ENABLE ROW LEVEL SECURITY;

-- テナント境界（RESTRICTIVE）。他のポリシーが緩んでも他店のルールには触れない。
DROP POLICY IF EXISTS tenant_isolation ON public.booking_frequency_limits;
CREATE POLICY tenant_isolation ON public.booking_frequency_limits AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 読み: お客様は「全員向けのルール」と「自分あてのルール」だけ。
-- 🔴 他のお客様の個別ルールは見せない（「あの人は制限されている」が同じジムの
--    別のお客様に分かるのはプライバシーの問題）。店側（owner/trainer）は全行見える。
DROP POLICY IF EXISTS booking_frequency_limits_select ON public.booking_frequency_limits;
CREATE POLICY booking_frequency_limits_select ON public.booking_frequency_limits
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_member(tenant_id, auth.uid())
    AND (
      user_id IS NULL
      OR user_id = auth.uid()
      OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer'])
    )
  );

-- 書けるのは店側（owner / trainer）だけ。
DROP POLICY IF EXISTS booking_frequency_limits_write ON public.booking_frequency_limits;
CREATE POLICY booking_frequency_limits_write ON public.booking_frequency_limits
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_frequency_limits_update ON public.booking_frequency_limits;
CREATE POLICY booking_frequency_limits_update ON public.booking_frequency_limits
  FOR UPDATE TO authenticated
  USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_frequency_limits_delete ON public.booking_frequency_limits;
CREATE POLICY booking_frequency_limits_delete ON public.booking_frequency_limits
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

-- 未ログインには一切見せない（公開ページ＝体験/ドロップインに制限の概念は無い）
REVOKE ALL ON public.booking_frequency_limits FROM anon;

-- updated_at を自動で進める（設定画面が丸ごと入れ直すため）。
CREATE OR REPLACE FUNCTION public.touch_booking_frequency_limits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_booking_frequency_limits ON public.booking_frequency_limits;
CREATE TRIGGER trg_touch_booking_frequency_limits
  BEFORE UPDATE ON public.booking_frequency_limits
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_booking_frequency_limits();

-- ----------------------------------------------------------------------------
-- トリガー: 自己予約の回数制限（GB003）
-- ----------------------------------------------------------------------------
-- check_booking_overlap（満枠）に混ぜないのは staff_schedules と同じ理由:
-- あの関数は bookings と trial_bookings の両方に付いていて、主目的に別の理由を
-- 混ぜるとどちらで落ちたのか分からなくなる。専用トリガーを別に足す。
-- （trial_bookings には付けない。体験・ドロップインは user_id を持たないゲストで、
--   回数を数える主体が存在しない。）

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

  -- 日時が変わらない UPDATE（キャンセル・メモ追記・担当変更）は見ない。
  -- 🔴 例外: 'キャンセル済み' からの復活は日時が変わらなくても見る。
  --    「キャンセル済みの行を先に置く → 別の枠を取る → 復活させる」で
  --    上限をすり抜けられるため（レビューで発覚した意図的バイパス経路）。
  --    正規のロールバック（'同日キャンセル済み' → '予約済み'）は OLD.status が
  --    'キャンセル済み' ではないので、この例外に当たらない。
  --
  -- なお実アプリの顧客リスケは UPDATE ではなく「旧行を消して INSERT」
  -- （useBookings.ts の rescheduleBooking）。この UPDATE 分岐は手で SQL を
  -- 叩く経路への防御として残している。
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;

  -- キャンセルへ倒す行は枠を増やさない
  IF NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  -- 同一人物の同時リクエスト（2端末・並列スクリプト）が両方 count=0 を見て
  -- 上限をすり抜けるレースを塞ぐ。トランザクション終了で自動解放。
  -- 素通し判定の後に置くので、代理予約や salute_sync の一括投入は直列化されない。
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || NEW.user_id::text));

  v_jst := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo');
  v_dow := EXTRACT(DOW FROM v_jst)::int;
  v_min := EXTRACT(HOUR FROM v_jst)::int * 60 + EXTRACT(MINUTE FROM v_jst)::int;

  FOR v_limit IN
    SELECT l.*
      FROM public.booking_frequency_limits l
     WHERE l.tenant_id = NEW.tenant_id
       AND l.enabled
       AND (l.user_id IS NULL OR l.user_id = NEW.user_id)
       AND v_dow = ANY (l.weekdays)
       -- 開始時刻が [start, end) に入るルールだけがマッチする
       AND v_min >= (split_part(l.start_time, ':', 1)::int * 60 + split_part(l.start_time, ':', 2)::int)
       AND v_min <  (split_part(l.end_time,   ':', 1)::int * 60 + split_part(l.end_time,   ':', 2)::int)
  LOOP
    IF v_limit.period = 'day' THEN
      v_from := v_jst::date;
      v_to   := v_from + 1;
    ELSE
      -- date_trunc('week') は月曜始まり（ISO）。クライアントの weekStartsOn: 1 と一致。
      v_from := date_trunc('week', v_jst)::date;
      v_to   := v_from + 7;
    END IF;

    -- 同じ期間×同じ時間帯×同じ曜日集合に、この人の予約が既に何件あるか。
    -- 'キャンセル済み' だけ除外（'同日キャンセル済み' は消化＝数える。満枠判定と同じ）。
    SELECT count(*) INTO v_count
      FROM public.bookings b
     WHERE b.tenant_id = NEW.tenant_id
       AND b.user_id   = NEW.user_id
       AND b.id IS DISTINCT FROM NEW.id     -- リスケ中の行の旧日時を数えない
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

REVOKE ALL ON FUNCTION public.guard_booking_frequency_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_frequency_limit ON public.bookings;
CREATE TRIGGER trg_guard_booking_frequency_limit
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_frequency_limit();

-- ----------------------------------------------------------------------------
-- delete_my_gym に booking_frequency_limits を足す
-- ----------------------------------------------------------------------------
-- ⚠️ この関数は**1回の定義に全テーブルを入れる**こと（20260820030000 の注意書き）。
--    分けて足すと最後の定義しか残らない。以下は 20260820030000 の定義に
--    booking_frequency_limits の1行を足したもの。

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
