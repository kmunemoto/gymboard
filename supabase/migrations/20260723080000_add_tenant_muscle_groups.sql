-- ジムごとに編集可能な「部位」マスター。トレーニング部位バランス(レーダーチャート)の
-- 軸と、種目管理画面の「部位」選択肢は、これまで固定7種（胸/背中/肩/脚/二頭筋/三頭筋/腹筋）
-- がハードコードされていたため「お尻」等を追加する手段が無かった。このテーブルで
-- テナントごとに部位の追加・改名・削除を可能にする。
CREATE TABLE public.tenant_muscle_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE public.tenant_muscle_groups ENABLE ROW LEVEL SECURITY;

-- 部位一覧はテナントメンバー（お客様・トレーナーどちらも）が読める
-- （レーダーチャートの軸として顧客画面でも必要なため）。
CREATE POLICY "Tenant members can view muscle groups"
  ON public.tenant_muscle_groups FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());

-- 追加・改名・削除はトレーナー/オーナーのみ（既存 exercises と同じ has_role パターン）。
CREATE POLICY "Trainers can insert muscle groups"
  ON public.tenant_muscle_groups FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can update muscle groups"
  ON public.tenant_muscle_groups FOR UPDATE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'trainer'))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'trainer'));

CREATE POLICY "Trainers can delete muscle groups"
  ON public.tenant_muscle_groups FOR DELETE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_role(auth.uid(), 'trainer'));

CREATE INDEX idx_tenant_muscle_groups_tenant ON public.tenant_muscle_groups(tenant_id, sort_order);

-- 既存テナント全件に、これまでの固定7種＋お尻(今回追加)を初期値としてバックフィルする。
-- これにより、このマイグレーション適用直後から見た目・挙動は変わらず（脚の隣にお尻が
-- 増えるだけ）、既存データが失われることもない。
INSERT INTO public.tenant_muscle_groups (tenant_id, name, sort_order)
SELECT t.id, g.name, g.ord
FROM public.tenants t
CROSS JOIN (VALUES
  ('胸', 1), ('背中', 2), ('肩', 3), ('脚', 4), ('お尻', 5),
  ('二頭筋', 6), ('三頭筋', 7), ('腹筋', 8)
) AS g(name, ord)
ON CONFLICT (tenant_id, name) DO NOTHING;
