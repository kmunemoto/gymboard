-- キャンセル待ち（満枠スロットへの登録）テーブル。
-- 既存のテナント分離RLSパターン（RESTRICTIVE tenant_isolation + 所有者/トレーナーのPERMISSIVE）を踏襲。
-- 追加のみ（新規テーブル）。冪等に書いてある。

CREATE TABLE IF NOT EXISTS public.booking_waitlist (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  user_id     uuid NOT NULL,
  booking_date date NOT NULL,
  start_time  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 同一ユーザーが同じ枠に重複登録しない
CREATE UNIQUE INDEX IF NOT EXISTS booking_waitlist_unique
  ON public.booking_waitlist (tenant_id, user_id, booking_date, start_time);

-- 枠単位の検索（空き発生時の通知などで使用）
CREATE INDEX IF NOT EXISTS booking_waitlist_slot_idx
  ON public.booking_waitlist (tenant_id, booking_date, start_time);

ALTER TABLE public.booking_waitlist ENABLE ROW LEVEL SECURITY;

-- テナント分離（RESTRICTIVE: 下のPERMISSIVEポリシーとAND結合される）
DROP POLICY IF EXISTS tenant_isolation ON public.booking_waitlist;
CREATE POLICY tenant_isolation ON public.booking_waitlist AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 顧客は自分の登録を、トレーナーは自テナント内を閲覧可能
DROP POLICY IF EXISTS waitlist_select ON public.booking_waitlist;
CREATE POLICY waitlist_select ON public.booking_waitlist
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'trainer'::app_role));

-- 顧客は自分の登録のみ作成可能
DROP POLICY IF EXISTS waitlist_insert ON public.booking_waitlist;
CREATE POLICY waitlist_insert ON public.booking_waitlist
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 顧客は自分の登録を、トレーナーは自テナント内を削除可能
DROP POLICY IF EXISTS waitlist_delete ON public.booking_waitlist;
CREATE POLICY waitlist_delete ON public.booking_waitlist
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'trainer'::app_role));
