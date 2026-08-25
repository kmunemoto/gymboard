-- 🔴 休会・退会が本番で1件も書けていなかったのを直す（2026-08-25）
--
-- tenant_members.status に CHECK が**2本**付いていて、通る値が積集合になっていた。
--
--   tenant_members_status_check … status IN ('active','paused','cancelled')
--     テーブルを作ったときのもの（20260517093130_…sql:62）。'paused' はアプリで
--     一度も使っていない語で、'suspended' / 'withdrawn' を許していない
--
--   tenant_members_status_known … status IS NULL OR status IN
--                                 ('active','suspended','withdrawn','cancelled')
--     休会・退会を入れたときのもの（20260808030000_member_lifecycle_and_payments.sql:107）
--
-- CHECK は全部満たす必要があるので、実際に書ける値は **active と cancelled だけ**。
-- 8/8 に休会・退会の機能を出してから、カルテの「休会にする」「退会にする」は
-- 押すたびに check_violation で失敗していた（本番の status は全72行が active）。
--
-- 古いほうを外す。'paused' は src / supabase のどこにも無く、本番にも1行も無い。
-- 状態の集合は tenant_members_status_known が引き続き守る。

DO $$
BEGIN
  -- 念のため: 'paused' の行が残っていたら外さない（値の意味を確かめてから手で消す）
  IF EXISTS (SELECT 1 FROM public.tenant_members WHERE status = 'paused') THEN
    RAISE EXCEPTION '想定外: status=''paused'' の行があります。先に値を確認してください';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tenant_members'::regclass
       AND conname = 'tenant_members_status_check'
  ) THEN
    ALTER TABLE public.tenant_members DROP CONSTRAINT tenant_members_status_check;
  END IF;
END $$;

-- 休会・退会を許す側が残っていることを確かめる（片方だけ落ちた状態を作らない）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tenant_members'::regclass
       AND conname = 'tenant_members_status_known'
  ) THEN
    ALTER TABLE public.tenant_members
      ADD CONSTRAINT tenant_members_status_known
      CHECK (status IS NULL OR status IN ('active', 'suspended', 'withdrawn', 'cancelled'));
  END IF;
END $$;
