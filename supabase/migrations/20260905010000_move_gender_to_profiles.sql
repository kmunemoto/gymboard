-- 性別を profiles へ移す ＋ workouts のゲーム用トリガーを外す（2026-09-05）
--
-- ゲーム要素（アバター・EXP・ガチャ・クエスト）を物理削除する作業の**第1段**。
-- 宗本さん:「今の予約や記録を削除してしまったりしてしまわないように」
--
-- 🔴 このマイグレーションは**行を1つも消さない**。
--    やるのは「列を足す」「値を写す」「トリガーを外す」の3つだけ。
--    DROP TRIGGER はトリガーを外すだけで、workouts の行には触れない。
--
-- ## なぜ性別を先に移すのか
--
-- お客様の性別の保存先が `user_avatars.gender` **しかない**。
-- これはゲームのテーブルだが、性別は**3つの実機能**で使われている:
--
--   1. 顧客一覧の「男性 / 女性」タブと人数（TrainerClientList）
--   2. カルテの性別設定（TrainerClientDetail）
--   3. お客様の記録画面の筋肉図の出し分け（CustomerTraining）
--
-- 先に移さずに user_avatars を落とすと、この3つが同時に壊れる。
--
-- ## 外すトリガー
--
-- どちらも `workouts` の AFTER INSERT。アプリ側の GAMIFICATION_ENABLED では止まらず、
-- **記録を保存するたびに今も書き込みが起きていた**（ガチャ券は 2026-09-05 にも発火）。
-- 対応する画面はもう無いので、利用者からは何も変わらない。

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender TEXT;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female'));

COMMENT ON COLUMN public.profiles.gender IS
  'お客様の性別。顧客一覧の絞り込みと、記録画面の筋肉図の出し分けに使う。'
  '2026-09-05 に user_avatars.gender から移した（アバターはゲーム要素として撤去するため）。';

-- 値を写す。**上書きしない**（p.gender IS NULL のときだけ入れる）ので、
-- 何度流しても手で直した値を壊さない。
UPDATE public.profiles p
   SET gender = a.gender
  FROM public.user_avatars a
 WHERE a.user_id = p.user_id
   AND a.gender IN ('male', 'female')
   AND p.gender IS NULL;

-- 🔴 トリガーを外す。**関数もテーブルも行もこの段では消さない**（第2段でまとめて消す）。
--    ここだけなら、付け直せば元に戻せる。
DROP TRIGGER IF EXISTS trg_grant_gacha_ticket    ON public.workouts;
DROP TRIGGER IF EXISTS trg_quest_battle_on_workout ON public.workouts;
