-- アクティブ顧客の数え方と、フォローの目安日数をジムごとに選べるようにする
--
-- 実店舗の要望（2026-09-23 宗本さん）:
--
-- > アクティブ顧客って何を基準に数えてるの？ 本当に今通っている人だけの数字を出して欲しい。
-- > 僕の場合は次回の予約が入ってない人はアクティブ顧客に数えないで欲しい。
-- > その辺、設定できるようにできる？ジムごとに
--
-- それまでの「アクティブ顧客」は**在籍している全員**（休会・退会にしていない人）で、
-- 実際に来ているかは見ていなかった。本番の自社ジムでは 42名と出ていたが、
-- 次の予約が入っている人は 22名だった。
--
-- ## 🔴 既定は今まで通り
--
-- 回数券の店のように「1回ずつその都度予約する」運用では、次の予約が無いのが普通で、
-- 「次回予約あり」で数えると通っている人まで数字から消える。
-- だから**既定は 'enrolled'（在籍の全員）**にして、選んだ店だけ切り替わる。
--
--   enrolled      … 在籍している全員（休会・退会を除く）。今まで通り
--   next_booking  … 今日以降に予約が入っている人（今日来る人は今日いっぱい数える）
--
-- ## フォローの目安日数
--
-- 最後の来店からこの日数が経ち、次の予約も無い人を「離れている」とみなす。
-- ホーム画面の「フォローが必要な顧客」も**同じこの日数**を使う
-- （それまでは画面に 14 と直書きされていた）。既定 14 で、今までと同じ。
-- 数字を2か所に持たせないので、「離れている ◯名」と「フォローが必要な顧客」の
-- 一覧は必ず同じ人たちになる。

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS active_client_basis text NOT NULL DEFAULT 'enrolled';
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS follow_up_after_days smallint NOT NULL DEFAULT 14;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_active_client_basis_known') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_active_client_basis_known
      CHECK (active_client_basis IN ('enrolled', 'next_booking'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_follow_up_after_days_range') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_follow_up_after_days_range
      CHECK (follow_up_after_days BETWEEN 3 AND 90);
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.active_client_basis IS
  'ホーム画面の「アクティブ顧客」の数え方。enrolled=在籍の全員（既定・従来どおり） / next_booking=今日以降に予約がある人。';
COMMENT ON COLUMN public.tenants.follow_up_after_days IS
  '最後の来店からこの日数が経ち次の予約も無い人を「離れている」とみなす（3〜90日・既定14）。「フォローが必要な顧客」も同じ値を使う。';
