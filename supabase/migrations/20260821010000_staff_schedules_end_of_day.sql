-- ============================================================================
-- スタッフのシフトの終了時刻に "24:00" を許す
-- ============================================================================
--
-- 営業時間の選択肢を1日の全域に広げたとき（2026-08-20、「選べる時間の範囲が狭い」
-- という実店舗からの指摘）、**シフトだけ 23:30 までのまま取り残されていた。**
--
--   営業時間  開店 00:00〜23:30 / 閉店 00:30〜24:00   ← 広げた
--   シフト    開始 00:00〜23:30 / 終了 00:00〜23:30   ← 残っていた
--
-- 24時間営業の店で「20:00〜24:00 のスタッフ」が表現できず、
-- 23:30 で切るしかなかった。**営業時間で選べる終業がシフトで選べない**のは
-- 単純に不整合なので揃える。
--
-- ## なぜ start_time は広げないか
--
-- `"24:00"` は「その日の終わり」を意味する終端専用の値
-- （`src/lib/businessHours.ts` の `DAY_END_MINUTES`）。
-- **24:00 に出勤を開始する人は居ない**ので、開始側に許すと
-- 「開始 24:00・終了 24:00」のような意味の無い行が作れてしまうだけになる。
--
-- ## 既存の制約はそのまま効く
--
--   staff_schedules_range CHECK (end_time > start_time)
--
-- 文字列比較だが、どちらもゼロ埋めの "HH:MM" なので辞書順＝時刻順。
-- `"24:00" > "23:30"` は true で正しく通る。
--
-- ## トリガーは直さなくてよい
--
-- guard_booking_staff_shift は
--   split_part(s.end_time, ':', 1)::int * 60 + split_part(s.end_time, ':', 2)::int
-- で分に直しているので、`"24:00"` は 24*60 = 1440 になり**そのまま正しく動く**。
-- （`v_min <  1440` の比較なので、23:45 開始の予約も通る。）
-- ============================================================================

ALTER TABLE public.staff_schedules
  DROP CONSTRAINT IF EXISTS staff_schedules_end_time_check;

-- 元の CHECK は列定義に無名で付いているため、名前が環境によって違いうる。
-- pg_constraint から end_time だけを見ている CHECK を探して落とす。
DO $$
DECLARE
  v_name TEXT;
BEGIN
  FOR v_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'staff_schedules'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%end_time%'
       -- 開始と終了の前後関係を見る制約は残す（別の役割なので落とさない）
       AND pg_get_constraintdef(c.oid) NOT LIKE '%start_time)%'
       AND c.conname <> 'staff_schedules_range'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_schedules DROP CONSTRAINT %I', v_name);
  END LOOP;
END $$;

-- 00:00〜23:59 に加えて、終端専用の "24:00" を許す。
-- "24:30" や "25:00" は引き続き弾く（クライアント側 parseTimeToMinutes と同じ規則）。
ALTER TABLE public.staff_schedules
  ADD CONSTRAINT staff_schedules_end_time_check
  CHECK (end_time ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$');

COMMENT ON COLUMN public.staff_schedules.end_time IS
  'シフトの終了時刻 "HH:MM"。"24:00" は「その日いっぱい」（24時間営業向けの終端専用の値）。'
  '開始側には使わない。解釈は src/lib/businessHours.ts の parseTimeToMinutes に揃えること。';
