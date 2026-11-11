-- ============================================================================
-- 退会したお客様を、元のジムのオーナーが API で「在籍」に戻せないようにする・1人が在籍中にできるジムは1つ（2026-11-11）
-- ============================================================================
-- 宗本さん「全部直すで」（2026-11-10 の定期点検）。指摘 guard_tenant_member_identity-1（medium。反証役2体は low）・
-- tenant-members-reactivate-1（low）。
--
-- ■ 何が起きていたか
-- tenant_members の UPDATE は「そのジムのスタッフなら可」で、門番 guard_tenant_member_identity は user_id・tenant_id・role の
-- 変更しか見ていなかった。元のジムのオーナーが、退会したお客様の行を PATCH {"status":"active"} で在籍に戻せた
-- （画面には退会から戻すボタンは無く、API だけの操作）。戻すと、在籍中だけを通す RESTRICTIVE（shares_tenant_with_me）が開き、
-- その人の共通のプロフィール（電話・LINE ID など）・体の記録・写真（置き場は人ごとでジムごとではない）をまた読める・消せた。
-- 退会後に別のジムのインストラクターになった人を戻すと、在籍中の所属が2つになり、その人の「自分のジム」
-- （get_my_tenant_id は ORDER BY なしの LIMIT 1）が戻したジムに切り替わりうるうえ、本人は自分で戻せなかった。
--
-- ■ 直し方
-- 1. guard_tenant_member_identity（本番の定義を写して2つ足す）:
--    (a) 退会・解約（withdrawn・cancelled）からほかの状態へ変えられるのは、本人とサーバー（運営の service_role・auth.uid() が無い）
--        だけ。お客様が戻ってくるときは、今まで通り招待コードで参加し直す／間違えて退会にしたときは運営が戻す。
--        休会からの再開（suspended → active）は今まで通り（画面の正規の操作）。
--    (b) 在籍中にするとき、同じ人が他のジムで在籍中なら断る（理由は出さない）。
-- 2. 1人が在籍中にできるジムは1つ（部分一意索引）。画面はもともと1人1ジム（参加 JoinGym・ジムの開設 Onboarding は既存の
--    所属があれば止める。インストラクターの参加は他のジムで在籍中なら断る）で、本番で2つ以上のジムに所属の行がある人は0人
--    （2026-11-11）。API でジムを開く（create_gym_with_owner）経路でも二重の在籍を作れなくなり、「自分のジム」は必ず1つに決まる。
-- 画面の操作（休会・再開・退会）は今まで通り。退会から戻すボタンはどの版のアプリにも無い。
--
-- 見張り: src/test/tenantMemberStatusGuard.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_tenant_member_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION '所属の user_id は変更できません' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION '所属の tenant_id は変更できません' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     AND coalesce(current_setting('app.owner_transfer', true), '') <> '1' THEN
    RAISE EXCEPTION '所属の role は変更できません' USING ERRCODE = 'check_violation';
  END IF;

  -- (a) 退会・解約からは、本人（とサーバー）しか戻せない（2026-11-11 点検 guard_tenant_member_identity-1）
  IF NEW.status IS DISTINCT FROM OLD.status
     AND OLD.status IN ('withdrawn', 'cancelled')
     AND auth.uid() IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION '退会・解約したお客様は在籍に戻せません。お客様に招待コードで参加し直してもらってください'
      USING ERRCODE = 'check_violation';
  END IF;

  -- (b) 他のジムで在籍中の人は、在籍にできない（1人1在籍。点検 tenant-members-reactivate-1）。理由は出さない
  IF NEW.status = 'active'
     AND OLD.status IS DISTINCT FROM 'active'
     AND EXISTS (
       SELECT 1 FROM public.tenant_members o
        WHERE o.user_id = NEW.user_id
          AND o.tenant_id <> NEW.tenant_id
          AND o.status = 'active'
     ) THEN
    RAISE EXCEPTION 'この方は在籍に戻せません' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- 1人が在籍中にできるジムは1つ（INSERT の経路も含めて DB で強制する）
CREATE UNIQUE INDEX IF NOT EXISTS tenant_members_one_active_per_user
  ON public.tenant_members (user_id)
  WHERE status = 'active';
