-- tenant_members への書き込みを絞る（テナント境界を「攻撃者が書き換えられる値」でなくする）
--
-- ## 何が問題だったか
--
-- 2026-08-03 まで、tenant_members にはこのポリシーが張られていた:
--
--   CREATE POLICY "Trainers/owners can manage members" ON public.tenant_members FOR ALL TO authenticated
--     USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
--     WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));
--
-- WITH CHECK が検証しているのは「**呼び出し元が** その tenant_id において owner/trainer か」
-- だけで、**挿入される user_id には一切の制約が無い**。FOR ALL なので DELETE も同条件。
--
-- つまりトレーナーは、ブラウザのコンソールから1行で
--
--   supabase.from('tenant_members').insert({ tenant_id: '<自分の店>', user_id: '<他店の顧客>',
--                                            role: 'customer', status: 'active' })
--
-- と書くだけで、**他店の顧客を自分の店の顧客ということにできた**。
-- そのあと同じポリシーで DELETE すれば痕跡も消せる。
--
-- これが通ると shares_tenant_with_me() が真になり、profiles / skeletal_diagnoses
-- （接骨院版なら施術記録）などの RESTRICTIVE なテナント境界がその人に対して開く。
-- **テナント分離の土台そのものが、攻撃者が書き換えられる値になっていた。**
--
-- UPDATE も同様に危険だった。RLS の WITH CHECK は「更新後の行」しか見ないので、
-- 自テナントの既存行の user_id を被害者のものに差し替えても素通りする。
--
-- ## 直し方
--
--   INSERT … 自分の行だけ（既存の "Users can insert own membership" のみ残す）
--   UPDATE … 自テナントの行だけ。ただし user_id / tenant_id / role は変更禁止（トリガー）
--   DELETE … そのテナントの owner だけ
--   SELECT … 変更なし（"Members can view same tenant members" / "Users can view own membership"）
--
-- 顧客の加入は従来どおり招待コード経由（JoinGym → 自分の行を insert）。
-- スタッフの追加は service_role（ダッシュボード / Edge Function）で行う。
-- アプリ側に「他人の tenant_members 行を作る」導線は元々無い（2026-08-03 に全走査して確認）。

-- ============================================================
-- 1) 危険な FOR ALL ポリシーを廃止する
-- ============================================================
DROP POLICY IF EXISTS "Trainers/owners can manage members" ON public.tenant_members;

-- ============================================================
-- 2) UPDATE: 自テナントの行だけ
-- ============================================================
-- 顧客のプラン変更（TrainerClientDetail の handlePlanChange）がこれを使う。
-- USING  = 更新前の行が自テナントにあること
-- WITH CHECK = 更新後の行も自テナントに留まること（他テナントへ移せない）
DROP POLICY IF EXISTS "Trainers/owners can update members in own tenant" ON public.tenant_members;
CREATE POLICY "Trainers/owners can update members in own tenant"
ON public.tenant_members
FOR UPDATE
TO authenticated
USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

-- ============================================================
-- 3) DELETE: そのテナントの owner だけ
-- ============================================================
-- trainer から DELETE を外すのは「証拠を消せる」経路を塞ぐため。
-- アプリ側に会員削除の導線は無いので、実運用の挙動は変わらない。
DROP POLICY IF EXISTS "Owners can delete members in own tenant" ON public.tenant_members;
CREATE POLICY "Owners can delete members in own tenant"
ON public.tenant_members
FOR DELETE
TO authenticated
USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner']));

-- ============================================================
-- 4) 行の同一性（user_id / tenant_id / role）を UPDATE で変えられないようにする
-- ============================================================
-- RLS の WITH CHECK は「更新後の行」しか見えないので、旧値との比較ができない。
-- つまり「自テナントの行の user_id を被害者のものに差し替える」は
-- ポリシーだけでは塞げない。ここはトリガーで塞ぐ。
--
-- 列レベルの GRANT でも表現できるが、Supabase の
-- `GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated` が後から流れると
-- 黙って元に戻ってしまうため採らない。トリガーは上書きされない。
--
-- auth.uid() が NULL のとき（service_role / ダッシュボード / マイグレーション）は
-- 対象外。運用上の付け替えを止めてしまわないため。
CREATE OR REPLACE FUNCTION public.guard_tenant_member_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION '所属の user_id は変更できません'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION '所属の tenant_id は変更できません'
      USING ERRCODE = 'check_violation';
  END IF;

  -- role の昇格（trainer → owner）を店内から行えないようにする
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION '所属の role は変更できません'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tenant_member_identity ON public.tenant_members;
CREATE TRIGGER trg_guard_tenant_member_identity
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_tenant_member_identity();

COMMENT ON FUNCTION public.guard_tenant_member_identity() IS
  'tenant_members の user_id / tenant_id / role をクライアントから書き換えられないようにする。RLS の WITH CHECK は更新後の行しか見えないため、ポリシーだけでは塞げない。service_role（auth.uid() が NULL）は対象外。';
