-- オーナーがアカウントを削除できるようにする（2026-08-13）
--
-- ═══════════════════════════════════════════════════════════════════
-- 何が起きていたか
-- ═══════════════════════════════════════════════════════════════════
--
-- `delete_my_account()` は active な owner を無条件で拒否する:
--
--     IF v_is_owner THEN RAISE EXCEPTION 'Owner cannot delete account'; END IF;
--
-- **この判断自体は正しい。** オーナーだけ消すと、ジム・お客様・予約・入金記録が
-- 「管理者のいない状態」で残る。
--
-- 問題は、画面が案内する逃げ道が**どちらも存在しなかった**こと:
--
--   「先にジムを削除する」   → ジムを削除する機能が無い
--   「別のオーナーに引き継ぐ」 → 引き継ぎ機能も無い
--
-- つまり**オーナーはアプリからアカウントを削除する手段が一切無かった**。
-- Apple のガイドライン 5.1.1(v)（アカウントを作れるならアプリ内で削除できること）
-- と Google Play の同等要件に対しても、審査担当者がオーナーで試すと詰む。
--
-- ═══════════════════════════════════════════════════════════════════
-- 入れるもの
-- ═══════════════════════════════════════════════════════════════════
--
--   1. transfer_gym_ownership()  … 別のスタッフに引き継ぐ（ジムは残る）
--   2. delete_my_gym()           … ジムごと閉じる（**他に在籍者がいないときだけ**）
--
-- ## 🔴 なぜ「他に在籍者がいないときだけ」なのか
--
-- お客様が在籍しているジムを、オーナーの都合だけで消せてしまうと、
-- **第三者のデータ（予約・カルテ・入金記録）を巻き添えで消す**ことになる。
-- 実運用で必要になるのは「廃業するのでデータを整理したい」という話で、
-- それは告知・エクスポートまで含めて設計すべき別件。
--
-- ここで解くのは「オーナーがアカウントを削除できない」という行き止まりだけにする。
--   ・お客様がいる → **引き継ぐ**（1）
--   ・誰もいない（試したジム・使わなくなったジム）→ **閉じる**（2）
--
-- 在籍者がいる状態で閉じたい場合は、先に退会処理をしてもらう。
-- そのほうが「気づいたらジムごと消えていた」より確実に安全。

-- ── 1. 引き継ぎ ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.transfer_gym_ownership(_to_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_tenant_id UUID;
  v_target    public.tenant_members%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 自分が active な owner であるジムを取る
  SELECT tenant_id INTO v_tenant_id
    FROM public.tenant_members
   WHERE user_id = v_uid AND role = 'owner' AND status = 'active'
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _to_user_id = v_uid THEN
    RAISE EXCEPTION 'same_user' USING ERRCODE = 'check_violation';
  END IF;

  -- 引き継ぎ先は**同じジムの在籍スタッフ**だけ。
  -- 🔴 お客様には渡せない。渡せてしまうと、お客様のアカウントが
  --    ジム全体（他のお客様のカルテ・入金記録）を見られる状態になる。
  SELECT * INTO v_target
    FROM public.tenant_members
   WHERE tenant_id = v_tenant_id
     AND user_id = _to_user_id
     AND role = 'trainer'
     AND status = 'active';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_staff' USING ERRCODE = 'check_violation';
  END IF;

  -- 入れ替え。**先に新オーナーを立てる**（途中で失敗しても無主にしない）。
  -- 関数全体が1トランザクションなので、どちらか片方だけ残ることはない。
  UPDATE public.tenant_members
     SET role = 'owner'
   WHERE tenant_id = v_tenant_id AND user_id = _to_user_id;

  UPDATE public.tenant_members
     SET role = 'trainer'
   WHERE tenant_id = v_tenant_id AND user_id = v_uid;

  -- グローバルロール。新オーナーが trainer 権限を持っていないと、
  -- has_role(trainer) を見ている画面が一斉に閉じる。
  INSERT INTO public.user_roles (user_id, role)
  VALUES (_to_user_id, 'trainer'::app_role)
  ON CONFLICT DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.transfer_gym_ownership(UUID) IS
  'ジムのオーナーを同じジムの在籍スタッフへ引き継ぐ。元オーナーは trainer になる。'
  'お客様には引き継げない（ジム全体が見える権限になるため）。';

REVOKE ALL ON FUNCTION public.transfer_gym_ownership(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_gym_ownership(UUID) TO authenticated;

-- ── 2. ジムを閉じる ─────────────────────────────────────────────────
--
-- ⚠️ 削除の順序は**外部キーの向き**で決まっている。types.ts の Relationships から
--    洗い出した依存は3本:
--
--      announcement_reads → announcements      （テナント外→テナント内。先に消す）
--      member_agreements  → messages           （テナント内どうし）
--      workouts           → exercises          （テナント内どうし）
--
--    さらに **dungeon_stages → exercises** と **season_events → tenant_plans** が
--    存在する。どちらもグローバルなゲーム内容のテーブルで、通常はテナントの行を
--    指さないはずだが、**指していれば削除は外部キーで失敗する**。
--    関数は1トランザクションなので、その場合は**何も消えずに落ちる**（半端に壊れない）。

CREATE OR REPLACE FUNCTION public.delete_my_gym()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_tenant_id UUID;
  v_others    INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT tenant_id INTO v_tenant_id
    FROM public.tenant_members
   WHERE user_id = v_uid AND role = 'owner' AND status = 'active'
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 🔴 自分以外の在籍者がいたら閉じさせない。
  --    退会・休会（status が active 以外）は数えない＝「もう誰も使っていない」なら閉じられる。
  SELECT count(*) INTO v_others
    FROM public.tenant_members
   WHERE tenant_id = v_tenant_id
     AND user_id <> v_uid
     AND status = 'active';

  IF v_others > 0 THEN
    RAISE EXCEPTION 'members_remain:%', v_others USING ERRCODE = 'check_violation';
  END IF;

  -- 外側 → 内側の順に落とす
  DELETE FROM public.announcement_reads
   WHERE announcement_id IN (SELECT id FROM public.announcements WHERE tenant_id = v_tenant_id);

  DELETE FROM public.member_agreements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_reactions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.messages            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_templates   WHERE tenant_id = v_tenant_id;

  DELETE FROM public.workouts            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercise_id_map     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercises           WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_muscle_groups WHERE tenant_id = v_tenant_id;

  DELETE FROM public.booking_waitlist    WHERE tenant_id = v_tenant_id;
  DELETE FROM public.bookings            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.blocked_slots       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.trial_bookings      WHERE tenant_id = v_tenant_id;

  DELETE FROM public.member_payments     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.counseling_responses WHERE tenant_id = v_tenant_id;
  DELETE FROM public.monthly_reports     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.progress_photos     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.user_measurements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.meals               WHERE tenant_id = v_tenant_id;
  DELETE FROM public.notification_settings WHERE tenant_id = v_tenant_id;
  DELETE FROM public.announcements       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.migration_user_map  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_plans        WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenant_members      WHERE tenant_id = v_tenant_id;

  -- 🔴 profiles は**消さない**。ジムを閉じてもアカウントは本人のもの。
  --    所属だけ外す（残すと、消えたジムを指したままになる）。
  UPDATE public.profiles SET tenant_id = NULL WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenants WHERE id = v_tenant_id;
END;
$$;

COMMENT ON FUNCTION public.delete_my_gym() IS
  'オーナーが自分のジムを閉じる。**自分以外に在籍者がいるときは拒否する**'
  '（お客様のデータを巻き添えで消さないため。その場合は引き継ぐか、先に退会処理を）。'
  'profiles は消さず所属だけ外す（アカウントは本人のもの）。';

REVOKE ALL ON FUNCTION public.delete_my_gym() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_gym() TO authenticated;
