-- ============================================================================
-- 予約時のカスタム質問（事前アンケート） booking_questions
-- ============================================================================
--
-- カウンセリング（counseling_responses）は項目がコードに固定されていて入会時にしか
-- 使えない。エアリザーブの「アンケート」に当たる「**店が自分で質問を作って、
-- 予約のときに聞く**」がジムボードには無かった。業種で聞きたいことは違う
-- （ジム=目標/既往歴、整骨=痛む部位、ピラティス=経験）ので、
-- **コードではなく店ごとの設定**として持つのが正しい置き場所になる。
--
-- ## 🔴 回答は参照ではなく「スナップショット」で持つ
--
-- 回答は booking_questions への外部キーではなく、**そのとき聞いた文言ごと**
-- bookings.custom_answers / trial_bookings.custom_answers（jsonb）に焼き付ける。
--
--   [{ "question_id": "…", "label": "本日の体調", "value": "良い" }]
--
-- 参照にすると、店が質問を消した瞬間に過去の回答が意味不明になる
-- （「はい」とだけ残って何に対する「はい」か分からない）。
-- 予約の付随データという性質上、正規化より「後から読める」ほうが価値が高い。
-- だから回答テーブルは作らない。**join も要らない**（一覧が速い）。
--
-- ## 聞く場所は質問ごとに選ぶ
--
--   ask_on_member … お客様の予約（CustomerBooking）・店側の代理予約
--   ask_on_trial  … 体験予約（/trial）・ドロップイン（/drop-in）
--
-- 両方 false の質問はどこにも出ない（下書き）。is_active = false も同じ。
--
-- ## anon はどうやって質問を読むか
--
-- 体験・ドロップインは未ログインで開く。RLS で anon に SELECT を許すのではなく、
-- **SECURITY DEFINER の get_tenant_booking_questions(uuid) を1本足す**。
-- テーブルに anon の口を開けると、列を足したときに何が公開されるか読み切れなくなる。
-- 関数なら**返す列を明示**でき、公開範囲が関数定義そのものになる
-- （get_tenant_public と同じ考え方）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label         TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  help_text     TEXT CHECK (help_text IS NULL OR char_length(help_text) <= 200),
  -- text / textarea / select / checkbox。増やすときは
  -- src/lib/bookingQuestions.ts の QUESTION_INPUT_TYPES と両方直すこと
  -- （src/test/bookingQuestions.test.ts が一致を見張る）。
  input_type    TEXT NOT NULL DEFAULT 'text'
                CHECK (input_type IN ('text', 'textarea', 'select', 'checkbox')),
  -- select のときの選択肢（文字列の配列）。それ以外では無視される。
  options       JSONB,
  required      BOOLEAN NOT NULL DEFAULT false,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  ask_on_member BOOLEAN NOT NULL DEFAULT true,
  ask_on_trial  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 選択肢は配列でなければならない（オブジェクトを入れると画面が落ちる）。
  CONSTRAINT booking_questions_options_shape
    CHECK (options IS NULL OR jsonb_typeof(options) = 'array'),
  -- 選択肢が多すぎるとプルダウンが使い物にならない。
  CONSTRAINT booking_questions_options_count
    CHECK (options IS NULL OR jsonb_array_length(options) <= 20)
);

CREATE INDEX IF NOT EXISTS idx_booking_questions_tenant
  ON public.booking_questions (tenant_id, sort_order);

COMMENT ON TABLE public.booking_questions IS
  '店が自分で作る、予約時のカスタム質問（事前アンケート）。'
  '回答はこの表を参照せず、bookings/trial_bookings.custom_answers に'
  '「聞いた文言ごと」スナップショットとして保存する。';

ALTER TABLE public.booking_questions ENABLE ROW LEVEL SECURITY;

-- テナント境界（RESTRICTIVE）。他店の質問には触れない。
DROP POLICY IF EXISTS tenant_isolation ON public.booking_questions;
CREATE POLICY tenant_isolation ON public.booking_questions AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 同じジムの人は読める（お客様は予約画面で答えるために読む）。
DROP POLICY IF EXISTS booking_questions_select ON public.booking_questions;
CREATE POLICY booking_questions_select ON public.booking_questions
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

-- 作れる／直せる／消せるのは店側だけ。
DROP POLICY IF EXISTS booking_questions_insert ON public.booking_questions;
CREATE POLICY booking_questions_insert ON public.booking_questions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_questions_update ON public.booking_questions;
CREATE POLICY booking_questions_update ON public.booking_questions
  FOR UPDATE TO authenticated
  USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_questions_delete ON public.booking_questions;
CREATE POLICY booking_questions_delete ON public.booking_questions
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

-- 未ログインはテーブルを直接読まない（下の関数だけが公開の口）。
REVOKE ALL ON public.booking_questions FROM anon;

CREATE OR REPLACE FUNCTION public.touch_booking_questions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_booking_questions ON public.booking_questions;
CREATE TRIGGER trg_touch_booking_questions
  BEFORE UPDATE ON public.booking_questions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_booking_questions();

-- ============================================================================
-- 回答の置き場所（jsonb スナップショット）
-- ============================================================================
-- bookings は列単位の GRANT を持たない＝お客様が任意の列を書ける。
-- 回答は本人が書くものなのでそれでよいが、**大きさだけは DB で縛る**
-- （巨大な jsonb を入れられると予定表の読み込みが丸ごと重くなる）。
-- ============================================================================

ALTER TABLE public.bookings       ADD COLUMN IF NOT EXISTS custom_answers JSONB;
ALTER TABLE public.trial_bookings ADD COLUMN IF NOT EXISTS custom_answers JSONB;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_custom_answers_shape') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_custom_answers_shape
      CHECK (custom_answers IS NULL
             OR (jsonb_typeof(custom_answers) = 'array'
                 AND jsonb_array_length(custom_answers) <= 10
                 AND char_length(custom_answers::text) <= 8000));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trial_bookings_custom_answers_shape') THEN
    ALTER TABLE public.trial_bookings ADD CONSTRAINT trial_bookings_custom_answers_shape
      CHECK (custom_answers IS NULL
             OR (jsonb_typeof(custom_answers) = 'array'
                 AND jsonb_array_length(custom_answers) <= 10
                 AND char_length(custom_answers::text) <= 8000));
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.custom_answers IS
  'booking_questions への回答のスナップショット。'
  '[{"question_id":"…","label":"聞いた文言","value":"回答"}]。'
  '質問を後から直しても、過去の回答は聞いたときの文言のまま残る。';

COMMENT ON COLUMN public.trial_bookings.custom_answers IS
  'booking_questions への回答のスナップショット（bookings.custom_answers と同じ形）。';

-- ============================================================================
-- 公開ページ（体験・ドロップイン）が anon で読む質問
-- ============================================================================
-- 返す列を関数定義で固定する。テーブルに anon の SELECT を開けないのは、
-- 後から列を足したときに何が公開されるか読み切れなくなるため。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_booking_questions(p_tenant_id uuid)
RETURNS TABLE(
  id uuid,
  label text,
  help_text text,
  input_type text,
  options jsonb,
  required boolean,
  sort_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT q.id, q.label, q.help_text, q.input_type, q.options, q.required, q.sort_order
    FROM public.booking_questions q
    JOIN public.tenants t ON t.id = q.tenant_id
   WHERE q.tenant_id = p_tenant_id
     AND q.is_active
     AND q.ask_on_trial
     AND t.status IN ('active', 'trial')
   ORDER BY q.sort_order, q.id;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_booking_questions(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_tenant_booking_questions(uuid) IS
  '公開ページ（体験予約・ドロップイン）が anon で読む、そのジムの事前アンケート項目。'
  'ask_on_trial かつ is_active のものだけを返す（会員専用の質問は返さない）。';

-- ============================================================================
-- ジムを閉じるときに新しい2表も消す
-- ============================================================================
-- 🔴 tenant_id を持つ表を足したら delete_my_gym に足す（src/test/gymOwnership.test.ts）。
--    FK は ON DELETE CASCADE だが、この関数は**明示 DELETE で完結させる**方針。
--    CASCADE 頼みの行を混ぜると「どこまでが明示か」を毎回考えることになる。
--
-- ⚠️ **1回の定義で staff_schedules と booking_questions の両方を入れる。**
--    20260820020000 でも作り直して1つずつ足すと、テストは連結したテキストを見るので
--    緑になるが、**本番の関数は最後の定義しか残らない**ので片方が消えずに残る。
-- ============================================================================

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
