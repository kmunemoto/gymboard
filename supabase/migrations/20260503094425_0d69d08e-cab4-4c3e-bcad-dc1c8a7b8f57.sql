-- Add metadata columns to exercises
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS muscle_group text,
  ADD COLUMN IF NOT EXISTS default_weight numeric,
  ADD COLUMN IF NOT EXISTS default_reps integer,
  ADD COLUMN IF NOT EXISTS default_sets integer,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Unique exercise name (case-sensitive). Use index to avoid failure on duplicate seeds.
CREATE UNIQUE INDEX IF NOT EXISTS exercises_name_key ON public.exercises(name);

-- Backfill muscle_group from existing category
UPDATE public.exercises SET muscle_group = CASE
  WHEN muscle_group IS NOT NULL AND muscle_group <> '' THEN muscle_group
  WHEN category = '胸' THEN '胸'
  WHEN category = '背中' THEN '背中'
  WHEN category = '肩' THEN '肩'
  WHEN category IN ('上腕二頭筋','上腕三頭筋','腕') THEN '腕'
  WHEN category = '脚・臀部' THEN '脚'
  WHEN category = '臀部' THEN '臀部'
  WHEN category IN ('体幹・腹筋','腹筋') THEN '腹筋'
  ELSE 'その他'
END
WHERE muscle_group IS NULL OR muscle_group = '';

ALTER TABLE public.exercises
  ALTER COLUMN muscle_group SET NOT NULL,
  ALTER COLUMN muscle_group SET DEFAULT 'その他';

-- Updated_at trigger
DROP TRIGGER IF EXISTS update_exercises_updated_at ON public.exercises;
CREATE TRIGGER update_exercises_updated_at
BEFORE UPDATE ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed common exercises (idempotent, only inserts missing names)
INSERT INTO public.exercises (name, category, muscle_group) VALUES
  ('ベンチプレス','胸','胸'),
  ('インクラインベンチプレス','胸','胸'),
  ('インクラインダンベルプレス','胸','胸'),
  ('ダンベルフライ','胸','胸'),
  ('ダンベルプレス','胸','胸'),
  ('チェストプレス','胸','胸'),
  ('ケーブルフライ','胸','胸'),
  ('ラットプルダウン','背中','背中'),
  ('シーテッドロー','背中','背中'),
  ('デッドリフト','背中','背中'),
  ('ベントオーバーロー','背中','背中'),
  ('チンニング','背中','背中'),
  ('ワンハンドロー','背中','背中'),
  ('懸垂','背中','背中'),
  ('ショルダープレス','肩','肩'),
  ('サイドレイズ','肩','肩'),
  ('フロントレイズ','肩','肩'),
  ('リアレイズ','肩','肩'),
  ('アーノルドプレス','肩','肩'),
  ('スクワット','脚・臀部','脚'),
  ('スミススクワット','脚・臀部','脚'),
  ('レッグプレス','脚・臀部','脚'),
  ('レッグエクステンション','脚・臀部','脚'),
  ('レッグカール','脚・臀部','脚'),
  ('ブルガリアンスクワット','脚・臀部','脚'),
  ('ワイドスクワット','脚・臀部','脚'),
  ('ランジ','脚・臀部','脚'),
  ('ヒップスラスト','脚・臀部','臀部'),
  ('ヒップアブダクション','脚・臀部','臀部'),
  ('アームカール','上腕二頭筋','腕'),
  ('ハンマーカール','上腕二頭筋','腕'),
  ('ケーブルカール','上腕二頭筋','腕'),
  ('トライセプスエクステンション','上腕三頭筋','腕'),
  ('キックバック','上腕三頭筋','腕'),
  ('クランチ','体幹・腹筋','腹筋'),
  ('レッグレイズ','体幹・腹筋','腹筋'),
  ('プランク','体幹・腹筋','腹筋'),
  ('アブローラー','体幹・腹筋','腹筋')
ON CONFLICT (name) DO NOTHING;