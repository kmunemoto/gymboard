-- セキュリティ修正（コードレビュー指摘 A-2 / A-3）
-- 1) counseling_responses のテナント越え個人情報漏洩を修正
-- 2) bookings の source='salute_sync' クライアント指定による整合性チェック回避を防止

-- =========================================================
-- 1) counseling_responses: テナント分離の抜け穴を塞ぐ
-- 背景: tenant_id 列を後付けしたが、匿名の問診フォーム（外部「カウンセリング
--   シート」アプリ）は tenant_id を送らず全行 NULL。閲覧/更新/削除ポリシーの
--   "tenant_id IS NULL" 抜け穴により、どのジムのトレーナーからも他ジムの
--   問診回答（氏名・電話・メール・病歴）が閲覧/編集/削除できる状態だった。
-- 対応:
--   (a) 既存 NULL 行を Salute御所南 に backfill（問診機能は現状 Salute 専用）。
--   (b) 列 DEFAULT を Salute に設定（外部フォームは tenant_id を送らないため、
--       新規行が NULL=不可視 になるのを防ぐ）。将来マルチテナント化する場合は
--       フォームから tenant_id を渡し、この DEFAULT を撤去すること。
--   (c) 閲覧/更新/削除から IS NULL 抜け穴を除去し、テナント一致を必須に。
--   (d) INSERT は tenant_id 必須（DEFAULT で満たされる）に。
DO $$
DECLARE v_salute uuid := 'ceda19b0-d5e0-4928-ab2e-996a0b823af4';
BEGIN
  UPDATE public.counseling_responses SET tenant_id = v_salute WHERE tenant_id IS NULL;
END $$;

ALTER TABLE public.counseling_responses
  ALTER COLUMN tenant_id SET DEFAULT 'ceda19b0-d5e0-4928-ab2e-996a0b823af4';

DROP POLICY IF EXISTS "Anyone can insert counseling responses" ON public.counseling_responses;
CREATE POLICY "Anyone can insert counseling responses"
  ON public.counseling_responses
  FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL);

DROP POLICY IF EXISTS "Trainers can view counseling responses" ON public.counseling_responses;
CREATE POLICY "Trainers can view counseling responses"
  ON public.counseling_responses
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'trainer'::public.app_role)
    AND tenant_id = public.get_my_tenant_id()
  );

DROP POLICY IF EXISTS "Trainers can update counseling responses" ON public.counseling_responses;
CREATE POLICY "Trainers can update counseling responses"
  ON public.counseling_responses
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'trainer'::public.app_role)
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'trainer'::public.app_role)
    AND tenant_id = public.get_my_tenant_id()
  );

DROP POLICY IF EXISTS "Trainers can delete counseling responses" ON public.counseling_responses;
CREATE POLICY "Trainers can delete counseling responses"
  ON public.counseling_responses
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'trainer'::public.app_role)
    AND tenant_id = public.get_my_tenant_id()
  );

-- =========================================================
-- 2) bookings: クライアントが source='salute_sync' を指定して
--    check_booking_overlap / 6月ガードを回避するのを防止。
-- salute_sync を設定するのは service_role の同期関数のみ（RLSをバイパスするため
--    引き続き動作）。anon/authenticated からの salute_sync 指定は拒否する。
-- INSERT のみ制限（新規予約に salute_sync を付けて overlap/6月ガードを回避するのを防ぐ）。
-- UPDATE は既存 salute_sync 行の正当な編集を壊さないため制限しない。
DROP POLICY IF EXISTS no_client_salute_source_insert ON public.bookings;
CREATE POLICY no_client_salute_source_insert ON public.bookings AS RESTRICTIVE
  FOR INSERT TO anon, authenticated
  WITH CHECK (source IS DISTINCT FROM 'salute_sync');
