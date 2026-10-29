-- ============================================================================
-- インストラクター（制限付き）はジム共通のマスタ（種目・部位・チャットの定型文）を変えられない（2026-10-29）
-- ============================================================================
-- 宗本さん「先生は設定欄を表示させない、触れない様に」。
-- 店の設定（tenants・プラン・予約のルール・シフト…）は 20261028020000 で止めてあるが、
-- 次の3つはトレーナーなら誰でも書けるまま残っていた（ジム全体に効く）:
--   - exercises（種目）・tenant_muscle_groups（部位）… 「種目管理」タブ
--   - message_templates（チャットの定型文。ジム共通）… メッセージ画面の歯車
--
-- 形は 20261028020000 と同じ（RESTRICTIVE を足すだけ。今あるポリシーは変えない）。
-- ⚠️ exercises の「追加」は止めない。記録の入力中の「新しい種目を追加」（TrainerClientDetail）は
--    先生の仕事なので。止めるのは既存の種目の書き換え・削除だけ。
-- 画面: 種目管理タブ・定型文の歯車をインストラクターに出さない（src/lib/staffAccess.ts・TrainerMessages）
-- ============================================================================

-- 種目: 書き換え・削除だけ止める（追加は記録の入力中に使う）
DROP POLICY IF EXISTS limited_staff_no_update ON public.exercises;
CREATE POLICY limited_staff_no_update ON public.exercises AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.exercises;
CREATE POLICY limited_staff_no_delete ON public.exercises AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

-- 部位
DROP POLICY IF EXISTS limited_staff_no_insert ON public.tenant_muscle_groups;
CREATE POLICY limited_staff_no_insert ON public.tenant_muscle_groups AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.tenant_muscle_groups;
CREATE POLICY limited_staff_no_update ON public.tenant_muscle_groups AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.tenant_muscle_groups;
CREATE POLICY limited_staff_no_delete ON public.tenant_muscle_groups AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));

-- チャットの定型文（使うのは止めない＝読みはそのまま）
DROP POLICY IF EXISTS limited_staff_no_insert ON public.message_templates;
CREATE POLICY limited_staff_no_insert ON public.message_templates AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_update ON public.message_templates;
CREATE POLICY limited_staff_no_update ON public.message_templates AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
DROP POLICY IF EXISTS limited_staff_no_delete ON public.message_templates;
CREATE POLICY limited_staff_no_delete ON public.message_templates AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_limited_staff(tenant_id, auth.uid()));
