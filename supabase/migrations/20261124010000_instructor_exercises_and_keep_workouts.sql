-- ============================================================================
-- インストラクターも種目を書き換え・削除できるようにする（2026-11-24）
-- 🔴 トレーニング記録に使われている種目は消せないようにする（消すと記録ごと消えていた）
--
-- 1) 宗本さん「ジムのオーナーじゃなくて…もう1人のトレーナーさん（マシンピラティス担当）。
--    その立場の人でも種目は触れるように追加して」。
--    20261029030000_limited_staff_master_data.sql で足した exercises の RESTRICTIVE
--    （limited_staff_no_update / limited_staff_no_delete）を外す。
--    元の PERMISSIVE（owner と trainer が書ける）はそのまま＝インストラクターもオーナーと同じに書ける。
--    部位（tenant_muscle_groups）・チャットの定型文（message_templates）は今まで通りオーナーだけ。
--
-- 2) workouts.exercise_id は exercises を ON DELETE CASCADE で参照していた。
--    種目を1つ消すと、その種目を使った**全員のトレーニング記録が一緒に消える**
--    （画面の確認は「過去のトレーニング記録には影響しません」と出していた）。
--    RESTRICT にして、記録に使われている種目は消せないようにする（23503。アプリは
--    「記録に使われているため削除できません」と出す）。使われていない種目は今まで通り消せる。
--    ジムの削除（delete_my_gym）は記録（workouts）を先に消すので影響しない。
--    古いアプリから消そうとしても、記録のある種目は「削除に失敗しました」で止まる（記録は消えない）。
--
-- 見張り: src/test/instructorExercises.test.tsx
-- ============================================================================

DROP POLICY IF EXISTS limited_staff_no_update ON public.exercises;
DROP POLICY IF EXISTS limited_staff_no_delete ON public.exercises;

ALTER TABLE public.workouts DROP CONSTRAINT IF EXISTS workouts_exercise_id_fkey;
ALTER TABLE public.workouts
  ADD CONSTRAINT workouts_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.workouts VALIDATE CONSTRAINT workouts_exercise_id_fkey;
