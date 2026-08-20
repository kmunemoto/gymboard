-- ============================================================================
-- スタッフ別の受付可否（シフト） staff_schedules
-- ============================================================================
--
-- 担当スタッフの指名（bookings.staff_user_id、20260804000000）は入っているのに、
-- **「そのスタッフがいつ働いているか」という概念がどこにも無かった。**
-- 火・木しか出ていないトレーナーでも、月曜の枠に指名予約が入ってしまう。
--
-- ## 🔴 行が1つも無いスタッフは「営業時間どおり」
--
-- これが最重要の後方互換ルール。既存のスタッフには当然1行も無いので、
-- 「行が無い＝働けない」と解釈すると**適用した瞬間に全店の指名予約が取れなくなる**。
--
--   そのスタッフの行が 0件   → 営業時間どおり（シフト未設定。従来の挙動）
--   そのスタッフの行が1件以上 → **書いてある曜日だけ**働く。書いていない曜日は休み
--
-- 「シフトを設定する」＝「働く曜日を列挙する」。全部消せば未設定に戻る。
-- この解釈はクライアント側 src/lib/staffSchedule.ts と**同じ規則**で、
-- src/test/staffSchedule.test.ts が両者の一致を見張る。
--
-- ## なぜ check_booking_overlap を書き換えないか
--
-- あの関数は bookings と trial_bookings の**両方**に付いていて、
-- trial_bookings には staff_user_id が無いため `to_jsonb(NEW) ->> …` で読んでいる。
-- 満枠判定という主目的に別の理由を混ぜると、どちらが原因で落ちたのか
-- エラーメッセージから分からなくなる。**専用のトリガーを別に足す**
-- （guard_booking_staff_assignment が既に同じ形で並んでいる）。
--
-- ## SQLSTATE を分ける
--
-- GB001 … その担当が同じ時間帯に別の予約を持っている（＝別の時間なら取れる）
-- GB002 … その担当はその曜日・時刻に働いていない（＝別の担当か別の曜日なら取れる）
--
-- お客様への案内が変わるので混ぜない。文言一致にしないのは、業種フォークが
-- メッセージを言い換えた瞬間に静かに壊れるため（20260804000000 と同じ理由）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.staff_schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  -- 0=日曜 … 6=土曜（JS の Date.getDay() と同じ並び）。
  weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  -- "HH:MM"。text で持つのは operating_hours と同じ表現に揃えるため
  -- （time 型にすると "10:00:00" になり、クライアント側で毎回削ることになる）。
  start_time  TEXT NOT NULL CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time    TEXT NOT NULL CHECK (end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 終わりが始まり以前の行は作らせない（枠が1つも出ない行はシフトとして無意味）。
  CONSTRAINT staff_schedules_range CHECK (end_time > start_time),
  -- 1人1曜日1行。分割シフト（午前だけ／午後だけ）は持たない。
  -- 必要になったらこの制約を外して、クライアント側の「いちばん広い範囲を採る」を
  -- 「複数区間」に変えることになる。今は要望が無いので単純に保つ。
  CONSTRAINT staff_schedules_unique_day UNIQUE (tenant_id, user_id, weekday)
);

CREATE INDEX IF NOT EXISTS idx_staff_schedules_tenant_user
  ON public.staff_schedules (tenant_id, user_id);

COMMENT ON TABLE public.staff_schedules IS
  'スタッフが働く曜日と時間帯。**行が1件も無いスタッフは「営業時間どおり」**（未設定）。'
  '1件でもあれば、書いてある曜日だけ働く。店の営業時間との積集合が実際に取れる範囲。';

COMMENT ON COLUMN public.staff_schedules.weekday IS '0=日曜 … 6=土曜（JS の Date.getDay() と同じ）';

ALTER TABLE public.staff_schedules ENABLE ROW LEVEL SECURITY;

-- テナント境界（RESTRICTIVE）。他のポリシーが緩んでも、他店のシフトには触れない。
DROP POLICY IF EXISTS tenant_isolation ON public.staff_schedules;
CREATE POLICY tenant_isolation ON public.staff_schedules AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 同じジムの人は読める。お客様も読む（指名できる担当を曜日で絞るため）。
DROP POLICY IF EXISTS staff_schedules_select ON public.staff_schedules;
CREATE POLICY staff_schedules_select ON public.staff_schedules
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

-- 書けるのは店側（owner / trainer）だけ。お客様は自分のシフトを作れない。
DROP POLICY IF EXISTS staff_schedules_write ON public.staff_schedules;
CREATE POLICY staff_schedules_write ON public.staff_schedules
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS staff_schedules_update ON public.staff_schedules;
CREATE POLICY staff_schedules_update ON public.staff_schedules
  FOR UPDATE TO authenticated
  USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS staff_schedules_delete ON public.staff_schedules;
CREATE POLICY staff_schedules_delete ON public.staff_schedules
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

-- 未ログインには一切見せない（公開ページに担当の指名は無い）。
REVOKE ALL ON public.staff_schedules FROM anon;

-- ============================================================================
-- 予約がスタッフのシフト外なら拒否する（GB002）
-- ============================================================================
-- 曜日は **JST の暦日**で数える。booking_date は timestamptz なので、
-- そのまま extract(dow) すると UTC の曜日になり、23:00 の予約が前日扱いになる。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_booking_staff_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_staff     UUID;
  v_old_staff UUID;
  v_jst       TIMESTAMP;
  v_dow       INT;
  v_min       INT;
  v_has_shift BOOLEAN;
  v_ok        BOOLEAN;
BEGIN
  -- trial_bookings には staff_user_id が無い。同じ関数を将来そちらに付けても
  -- 落ちないよう、列の有無に依存しない to_jsonb 経由で読む
  -- （guard_booking_staff_assignment と同じ作法）。
  v_staff := (to_jsonb(NEW) ->> 'staff_user_id')::uuid;
  IF v_staff IS NULL THEN
    RETURN NEW;   -- 指名なしはシフトの制約を受けない
  END IF;

  -- 担当が変わっていない UPDATE は見ない（キャンセルやメモ追記を止めないため。
  -- guard_booking_staff_assignment のコメントに詳しい）。
  IF TG_OP = 'UPDATE' THEN
    v_old_staff := (to_jsonb(OLD) ->> 'staff_user_id')::uuid;
    IF v_staff IS NOT DISTINCT FROM v_old_staff THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;   -- テナント不明では判定しようがない（別のトリガーが弾く）
  END IF;

  -- 🔴 シフトが1件も無いスタッフは「営業時間どおり」＝この制約を受けない。
  SELECT EXISTS (
    SELECT 1 FROM public.staff_schedules s
     WHERE s.tenant_id = NEW.tenant_id AND s.user_id = v_staff
  ) INTO v_has_shift;

  IF NOT v_has_shift THEN
    RETURN NEW;
  END IF;

  v_jst := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo');
  v_dow := EXTRACT(DOW FROM v_jst)::int;
  v_min := EXTRACT(HOUR FROM v_jst)::int * 60 + EXTRACT(MINUTE FROM v_jst)::int;

  SELECT EXISTS (
    SELECT 1 FROM public.staff_schedules s
     WHERE s.tenant_id = NEW.tenant_id
       AND s.user_id   = v_staff
       AND s.weekday   = v_dow
       -- 開始時刻がシフトの中にあること。終了までに終わるかは
       -- 枠の長さ（プラン別）を知る必要があり、それは満枠判定側の担当。
       AND v_min >= (split_part(s.start_time, ':', 1)::int * 60 + split_part(s.start_time, ':', 2)::int)
       AND v_min <  (split_part(s.end_time,   ':', 1)::int * 60 + split_part(s.end_time,   ':', 2)::int)
  ) INTO v_ok;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'この担当者はその時間帯のシフトに入っていません'
      USING ERRCODE = 'GB002';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_booking_staff_shift() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_staff_shift ON public.bookings;
CREATE TRIGGER trg_guard_booking_staff_shift
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_booking_staff_shift();

-- updated_at を自動で進める（設定画面が何度も上書きするため）。
CREATE OR REPLACE FUNCTION public.touch_staff_schedules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_staff_schedules ON public.staff_schedules;
CREATE TRIGGER trg_touch_staff_schedules
  BEFORE UPDATE ON public.staff_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_staff_schedules();
