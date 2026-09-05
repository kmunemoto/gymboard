-- ゲーム要素の撤去 第2段c: 残していた2列を落とす（2026-09-05）
--
-- 第2段b でテーブル50個・関数55本を落としたとき、この2列だけ残した。
-- 理由は「`schemaDrift.test.ts` のパーサが DROP COLUMN を解釈しない」ため:
--
--   declared（マイグレーションを畳んだ結果）に列が残る
--     → types.ts を再生成すると列が消える
--     → 「declared にある列が types.ts に無い」で**必ず赤**
--     → KNOWN_STALE に逃がすと、今度は「解消済みが残っている」の検査が落ちる
--
-- 逃げ道が無かったので、**先にパーサへ DROP COLUMN を足してからこの列を落とす**。
--
-- ## 落として安全なことの確認（本番で実測）
--
--   - 画面がどこも読んでいない（`game_mode` / `gamification` の grep が UI で0件）
--   - この2列に依存するポリシー・関数・索引・ビューが**0件**
--   - 予行演習（DROP → 数える → ROLLBACK）:
--       bookings 788->788 / workouts 2441->2441 / profiles 73->73
--       profiles+tenants の列 93->91

ALTER TABLE public.profiles DROP COLUMN IF EXISTS game_mode_enabled;
ALTER TABLE public.tenants  DROP COLUMN IF EXISTS gamification_enabled;
