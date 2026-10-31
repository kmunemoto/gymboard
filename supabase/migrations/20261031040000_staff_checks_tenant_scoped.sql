-- ============================================================================
-- 「trainer の印」だけでスタッフ扱いしていたルールを、ジムに結びついた判定に置き換える
-- （2026-10-31・セキュリティ点検・穴11）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- ■ 何が起きていたか
-- 多くのポリシーが `has_role(auth.uid(), 'trainer')` だけでスタッフと見なしていた。
-- この印（user_roles）は**ジムに結びついていない**うえ、新規登録の signup-trainer は誰でも呼べる
-- （ジムを開く人のための入口なので、これは仕様として残す）。
-- 別のジムからは RESTRICTIVE のテナント絞り（tenant_id = get_my_tenant_id()）が防いでいたが、
-- **同じジムのお客様**には効かない。お客様が自分に印を付けるだけで、そのジムの全員の
-- プロフィール・予約・チャット・食事の写真が読めた。
-- 本番で演じて確かめた（ROLLBACK 済み・実害なし。印を持つお客様は本番に0人）:
--   お客様＋印 … 他人のプロフィール 43・予約 655・メッセージ 171・食事の写真 14
--   招待コード無しで入った部外者＋印 … プロフィール 44・予約 671・メッセージ 171
--
-- ■ 直し方（印の判定だけを差し替える。ほかの条件は1文字も変えない）
--   tenant_id を持つ表 … public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
--                         （その行のジムで、有効なオーナー・トレーナー＝インストラクターを含む）
--   人ごとの表（profiles・weight_journey・skeletal_diagnoses・announcement_reads・user_roles）
--                       … public.is_staff_of_user(user_id)（その人がいる・いたジムで、自分がスタッフ）
--   Google カレンダーの連携（自分の行だけ）… public.is_staff_somewhere()
--   写真の置き場（storage）… 自分のジム（get_my_tenant_id）のスタッフか。フォルダの人が同じジムに
--                            在籍しているかの条件（shares_tenant_with_me）は今まで通り残す
--   トリガー2本（お客様の予約の削除・変更の制限）と招待コードの関数 … その予約・ジムのスタッフか
--
-- ■ 残したもの
--   - avatars の tenant-logos へのアップロード（"Authenticated avatar uploads scoped to user folder"）
--     … ジムを開く前（オンボーディングの1画面目）に呼ぶので、まだどのジムのスタッフでもない。
--       置けるのは `tenant-logos/<自分の user_id>-…` だけ（globalTrainerRole.test.ts で固定）
--   - create_gym_with_owner … ジムを開く関数そのもの。印を持つ人が新しいジムを開くのは仕様
--
-- ■ 変わらないこと
--   本番のスタッフ（オーナー22人・インストラクター1人）は全員、印と在籍の両方を持っている
--   （在籍だけで印が無い人は0人）。自分のジムの行に対しては、新旧の判定は同じ結果になる。
--   インストラクターの制限（is_limited_staff の RESTRICTIVE）は別のポリシーなので、そのまま効く。
--
-- 見張り: src/test/globalTrainerRole.test.ts・security/check.sql の検査10
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 判定の関数
-- ----------------------------------------------------------------------------

-- その人（p_user_id）がいる（いた）ジムで、呼び出した人が有効なスタッフ（オーナー・トレーナー）か。
-- 相手の在籍の状態は問わない。退会したお客様のロールも、そのジムのスタッフには今まで通り見える
-- （顧客の詳細画面は user_roles が読めるかでチャット欄を開く。TrainerClientDetail の isRegistered）。
-- profiles・weight_journey・skeletal_diagnoses・announcement_reads には RESTRICTIVE
-- （shares_tenant_with_me＝在籍中だけ）が別にかかるので、見える範囲は今まで通り。
CREATE OR REPLACE FUNCTION public.is_staff_of_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.tenant_members me
      JOIN public.tenant_members them ON them.tenant_id = me.tenant_id
     WHERE me.user_id = auth.uid()
       AND me.status = 'active'
       AND me.role IN ('owner', 'trainer')
       AND them.user_id = p_user_id
  );
$$;

-- どこかのジムで有効なスタッフか（自分の行だけを扱うポリシー用）
CREATE OR REPLACE FUNCTION public.is_staff_somewhere()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE user_id = auth.uid()
       AND status = 'active'
       AND role IN ('owner', 'trainer')
  );
$$;

-- ポリシーは TO authenticated なので、authenticated に EXECUTE が要る（外すとその表が読めなくなる。穴8）
REVOKE ALL ON FUNCTION public.is_staff_of_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_of_user(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_staff_somewhere() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_somewhere() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. tenant_id を持つ表
-- ----------------------------------------------------------------------------

-- お知らせ
DROP POLICY IF EXISTS "Trainers delete announcements" ON public.announcements;
CREATE POLICY "Trainers delete announcements" ON public.announcements
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers insert announcements" ON public.announcements;
CREATE POLICY "Trainers insert announcements" ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers update announcements" ON public.announcements;
CREATE POLICY "Trainers update announcements" ON public.announcements
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Users view own/all announcements" ON public.announcements;
CREATE POLICY "Users view own/all announcements" ON public.announcements
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
    OR (
      published_at <= now()
      AND (
        target = 'all'
        OR target = (auth.uid())::text
        OR (target = 'except' AND NOT public.announcement_audience_has(id, auth.uid()))
        OR (target = 'only' AND public.announcement_audience_has(id, auth.uid()))
      )
    )
  );

-- 予約を止めた枠
DROP POLICY IF EXISTS "Trainers can delete blocked slots" ON public.blocked_slots;
CREATE POLICY "Trainers can delete blocked slots" ON public.blocked_slots
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can insert blocked slots" ON public.blocked_slots;
CREATE POLICY "Trainers can insert blocked slots" ON public.blocked_slots
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can view blocked slots" ON public.blocked_slots;
CREATE POLICY "Trainers can view blocked slots" ON public.blocked_slots
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 休業日
DROP POLICY IF EXISTS booking_closed_days_delete ON public.booking_closed_days;
CREATE POLICY booking_closed_days_delete ON public.booking_closed_days
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS booking_closed_days_write ON public.booking_closed_days;
CREATE POLICY booking_closed_days_write ON public.booking_closed_days
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']) AND created_by = auth.uid());

-- 上限を外す日
DROP POLICY IF EXISTS booking_uncapped_days_delete ON public.booking_uncapped_days;
CREATE POLICY booking_uncapped_days_delete ON public.booking_uncapped_days
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS booking_uncapped_days_select ON public.booking_uncapped_days;
CREATE POLICY booking_uncapped_days_select ON public.booking_uncapped_days
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS booking_uncapped_days_write ON public.booking_uncapped_days;
CREATE POLICY booking_uncapped_days_write ON public.booking_uncapped_days
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']) AND created_by = auth.uid());

-- キャンセル待ち
DROP POLICY IF EXISTS waitlist_delete ON public.booking_waitlist;
CREATE POLICY waitlist_delete ON public.booking_waitlist
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS waitlist_select ON public.booking_waitlist;
CREATE POLICY waitlist_select ON public.booking_waitlist
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 予約
DROP POLICY IF EXISTS "Trainers can delete any bookings" ON public.bookings;
CREATE POLICY "Trainers can delete any bookings" ON public.bookings
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can insert any bookings" ON public.bookings;
CREATE POLICY "Trainers can insert any bookings" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can update any bookings" ON public.bookings;
CREATE POLICY "Trainers can update any bookings" ON public.bookings
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can view all bookings" ON public.bookings;
CREATE POLICY "Trainers can view all bookings" ON public.bookings
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- カウンセリングの回答（RESTRICTIVE が無い表。tenant_id が NULL の行は、今後どのジムからも見えない。本番は0件）
DROP POLICY IF EXISTS "Trainers can delete counseling responses" ON public.counseling_responses;
CREATE POLICY "Trainers can delete counseling responses" ON public.counseling_responses
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']) AND (tenant_id IS NULL OR tenant_id = public.get_my_tenant_id()));
DROP POLICY IF EXISTS "Trainers can update counseling responses" ON public.counseling_responses;
CREATE POLICY "Trainers can update counseling responses" ON public.counseling_responses
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']) AND (tenant_id IS NULL OR tenant_id = public.get_my_tenant_id()));
DROP POLICY IF EXISTS "Trainers can view counseling responses" ON public.counseling_responses;
CREATE POLICY "Trainers can view counseling responses" ON public.counseling_responses
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']) AND (tenant_id IS NULL OR tenant_id = public.get_my_tenant_id()));

-- 種目
DROP POLICY IF EXISTS "Trainers can delete exercises" ON public.exercises;
CREATE POLICY "Trainers can delete exercises" ON public.exercises
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can insert exercises" ON public.exercises;
CREATE POLICY "Trainers can insert exercises" ON public.exercises
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can update exercises" ON public.exercises;
CREATE POLICY "Trainers can update exercises" ON public.exercises
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- ジムの動画
DROP POLICY IF EXISTS gym_videos_delete ON public.gym_videos;
CREATE POLICY gym_videos_delete ON public.gym_videos
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS gym_videos_insert ON public.gym_videos;
CREATE POLICY gym_videos_insert ON public.gym_videos
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS gym_videos_select ON public.gym_videos;
CREATE POLICY gym_videos_select ON public.gym_videos
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']) OR published_at <= now());
DROP POLICY IF EXISTS gym_videos_update ON public.gym_videos;
CREATE POLICY gym_videos_update ON public.gym_videos
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 食事
DROP POLICY IF EXISTS "Trainers can delete any meals" ON public.meals;
CREATE POLICY "Trainers can delete any meals" ON public.meals
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can view all meals" ON public.meals;
CREATE POLICY "Trainers can view all meals" ON public.meals
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 同意書
DROP POLICY IF EXISTS member_agreements_delete ON public.member_agreements;
CREATE POLICY member_agreements_delete ON public.member_agreements
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS member_agreements_insert ON public.member_agreements;
CREATE POLICY member_agreements_insert ON public.member_agreements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS member_agreements_select ON public.member_agreements;
CREATE POLICY member_agreements_select ON public.member_agreements
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS member_agreements_update ON public.member_agreements;
CREATE POLICY member_agreements_update ON public.member_agreements
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 入金
DROP POLICY IF EXISTS member_payments_delete ON public.member_payments;
CREATE POLICY member_payments_delete ON public.member_payments
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS member_payments_insert ON public.member_payments;
CREATE POLICY member_payments_insert ON public.member_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS member_payments_select ON public.member_payments;
CREATE POLICY member_payments_select ON public.member_payments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS member_payments_update ON public.member_payments;
CREATE POLICY member_payments_update ON public.member_payments
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- チャットのリアクション（そのメッセージのジムのスタッフ）
DROP POLICY IF EXISTS message_reactions_insert ON public.message_reactions;
CREATE POLICY message_reactions_insert ON public.message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.id = message_reactions.message_id
         AND (auth.uid() = m.sender_id
              OR auth.uid() = m.receiver_id
              OR public.has_tenant_role(m.tenant_id, auth.uid(), ARRAY['owner', 'trainer']))
    )
  );
DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.id = message_reactions.message_id
         AND (auth.uid() = m.sender_id
              OR auth.uid() = m.receiver_id
              OR public.has_tenant_role(m.tenant_id, auth.uid(), ARRAY['owner', 'trainer']))
    )
  );

-- チャットの定型文
DROP POLICY IF EXISTS message_templates_delete ON public.message_templates;
CREATE POLICY message_templates_delete ON public.message_templates
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS message_templates_insert ON public.message_templates;
CREATE POLICY message_templates_insert ON public.message_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS message_templates_select ON public.message_templates;
CREATE POLICY message_templates_select ON public.message_templates
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS message_templates_update ON public.message_templates;
CREATE POLICY message_templates_update ON public.message_templates
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- チャット
DROP POLICY IF EXISTS "Receiver can mark read" ON public.messages;
CREATE POLICY "Receiver can mark read" ON public.messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = receiver_id OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']))
  WITH CHECK (auth.uid() = receiver_id OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can view all messages" ON public.messages;
CREATE POLICY "Trainers can view all messages" ON public.messages
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 月次レポート
DROP POLICY IF EXISTS "Trainers can delete monthly reports" ON public.monthly_reports;
CREATE POLICY "Trainers can delete monthly reports" ON public.monthly_reports
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can insert monthly reports" ON public.monthly_reports;
CREATE POLICY "Trainers can insert monthly reports" ON public.monthly_reports
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can update monthly reports" ON public.monthly_reports;
CREATE POLICY "Trainers can update monthly reports" ON public.monthly_reports
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can view all monthly reports" ON public.monthly_reports;
CREATE POLICY "Trainers can view all monthly reports" ON public.monthly_reports
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 運営へのご意見
DROP POLICY IF EXISTS operator_feedback_insert ON public.operator_feedback;
CREATE POLICY operator_feedback_insert ON public.operator_feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 体の写真（記録）
DROP POLICY IF EXISTS "Users can delete own progress photos" ON public.progress_photos;
CREATE POLICY "Users can delete own progress photos" ON public.progress_photos
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Users can view own progress photos" ON public.progress_photos;
CREATE POLICY "Users can view own progress photos" ON public.progress_photos
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 部位（今も get_my_tenant_id で絞っている。印の判定だけ差し替える）
DROP POLICY IF EXISTS "Trainers can delete muscle groups" ON public.tenant_muscle_groups;
CREATE POLICY "Trainers can delete muscle groups" ON public.tenant_muscle_groups
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can insert muscle groups" ON public.tenant_muscle_groups;
CREATE POLICY "Trainers can insert muscle groups" ON public.tenant_muscle_groups
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can update muscle groups" ON public.tenant_muscle_groups;
CREATE POLICY "Trainers can update muscle groups" ON public.tenant_muscle_groups
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']))
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 体験予約
DROP POLICY IF EXISTS "Trainers can delete trial bookings" ON public.trial_bookings;
CREATE POLICY "Trainers can delete trial bookings" ON public.trial_bookings
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can update trial bookings" ON public.trial_bookings;
CREATE POLICY "Trainers can update trial bookings" ON public.trial_bookings
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can view trial bookings" ON public.trial_bookings;
CREATE POLICY "Trainers can view trial bookings" ON public.trial_bookings
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 体組成
DROP POLICY IF EXISTS "Trainers can delete any measurements" ON public.user_measurements;
CREATE POLICY "Trainers can delete any measurements" ON public.user_measurements
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can insert any measurements" ON public.user_measurements;
CREATE POLICY "Trainers can insert any measurements" ON public.user_measurements
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can update any measurements" ON public.user_measurements;
CREATE POLICY "Trainers can update any measurements" ON public.user_measurements
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can view all measurements" ON public.user_measurements;
CREATE POLICY "Trainers can view all measurements" ON public.user_measurements
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- トレーニングの記録
DROP POLICY IF EXISTS "Trainers can delete any workouts" ON public.workouts;
CREATE POLICY "Trainers can delete any workouts" ON public.workouts
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can insert any workouts" ON public.workouts;
CREATE POLICY "Trainers can insert any workouts" ON public.workouts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can update any workouts" ON public.workouts;
CREATE POLICY "Trainers can update any workouts" ON public.workouts
  FOR UPDATE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));
DROP POLICY IF EXISTS "Trainers can view all workouts" ON public.workouts;
CREATE POLICY "Trainers can view all workouts" ON public.workouts
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- ----------------------------------------------------------------------------
-- 3. 人ごとの表（tenant_id が無い・当てにならない）… その人がいるジムのスタッフか
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users view own reads" ON public.announcement_reads;
CREATE POLICY "Users view own reads" ON public.announcement_reads
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_staff_of_user(user_id));

DROP POLICY IF EXISTS "Authenticated users can view own profile" ON public.profiles;
CREATE POLICY "Authenticated users can view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_staff_of_user(user_id));
DROP POLICY IF EXISTS "Trainers can update all profiles" ON public.profiles;
CREATE POLICY "Trainers can update all profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_staff_of_user(user_id));
DROP POLICY IF EXISTS "Trainers can view all profiles" ON public.profiles;
CREATE POLICY "Trainers can view all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_staff_of_user(user_id));

DROP POLICY IF EXISTS "Trainers can delete any diagnoses" ON public.skeletal_diagnoses;
CREATE POLICY "Trainers can delete any diagnoses" ON public.skeletal_diagnoses
  FOR DELETE TO authenticated
  USING (public.is_staff_of_user(user_id));
DROP POLICY IF EXISTS "Trainers can view all diagnoses" ON public.skeletal_diagnoses;
CREATE POLICY "Trainers can view all diagnoses" ON public.skeletal_diagnoses
  FOR SELECT TO authenticated
  USING (public.is_staff_of_user(user_id));

-- user_roles には RESTRICTIVE のテナント絞りが無く、今までは印を持つ人が**全ジム**の行を読めた
DROP POLICY IF EXISTS "Trainers can view all roles" ON public.user_roles;
CREATE POLICY "Trainers can view all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.is_staff_of_user(user_id));

DROP POLICY IF EXISTS "Trainers delete journey" ON public.weight_journey;
CREATE POLICY "Trainers delete journey" ON public.weight_journey
  FOR DELETE TO authenticated
  USING (public.is_staff_of_user(user_id));
DROP POLICY IF EXISTS "Trainers insert journey" ON public.weight_journey;
CREATE POLICY "Trainers insert journey" ON public.weight_journey
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff_of_user(user_id));
DROP POLICY IF EXISTS "Trainers update journey" ON public.weight_journey;
CREATE POLICY "Trainers update journey" ON public.weight_journey
  FOR UPDATE TO authenticated
  USING (public.is_staff_of_user(user_id));
DROP POLICY IF EXISTS "Users view own journey" ON public.weight_journey;
CREATE POLICY "Users view own journey" ON public.weight_journey
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_staff_of_user(user_id));

-- ----------------------------------------------------------------------------
-- 4. Google カレンダーの連携（自分の行だけ。印ではなく、どこかのジムのスタッフであること）
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Trainers can delete own tokens" ON public.google_calendar_tokens;
CREATE POLICY "Trainers can delete own tokens" ON public.google_calendar_tokens
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND public.is_staff_somewhere());
DROP POLICY IF EXISTS "Trainers can insert own tokens" ON public.google_calendar_tokens;
CREATE POLICY "Trainers can insert own tokens" ON public.google_calendar_tokens
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.is_staff_somewhere());
DROP POLICY IF EXISTS "Trainers can update own tokens" ON public.google_calendar_tokens;
CREATE POLICY "Trainers can update own tokens" ON public.google_calendar_tokens
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.is_staff_somewhere());
DROP POLICY IF EXISTS "Trainers can view own tokens" ON public.google_calendar_tokens;
CREATE POLICY "Trainers can view own tokens" ON public.google_calendar_tokens
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND public.is_staff_somewhere());

-- ----------------------------------------------------------------------------
-- 5. 写真・ジムの画像の置き場（storage）
--    meal/progress/posture のフォルダ名は本人の user_id（アップロードのポリシーが本人のフォルダに限っている）。
--    「印 AND shares_tenant_with_me(フォルダ)」の印だけを「自分のジムのスタッフ」に差し替える
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Owners and tenant trainers can delete meal photos" ON storage.objects;
CREATE POLICY "Owners and tenant trainers can delete meal photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'meal-photos'
    AND ((storage.foldername(name))[1] = (auth.uid())::text
         OR (public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
             AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)))
  );
DROP POLICY IF EXISTS "Owners and tenant trainers can update meal photos" ON storage.objects;
CREATE POLICY "Owners and tenant trainers can update meal photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'meal-photos'
    AND ((storage.foldername(name))[1] = (auth.uid())::text
         OR (public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
             AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)))
  );
DROP POLICY IF EXISTS "Owners and tenant trainers can view meal photos" ON storage.objects;
CREATE POLICY "Owners and tenant trainers can view meal photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'meal-photos'
    AND ((storage.foldername(name))[1] = (auth.uid())::text
         OR (public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
             AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)))
  );

DROP POLICY IF EXISTS "Tenant trainers can view posture photos" ON storage.objects;
CREATE POLICY "Tenant trainers can view posture photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'posture-photos'
    AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
    AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS "Users can delete own progress photos files" ON storage.objects;
CREATE POLICY "Users can delete own progress photos files" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND ((auth.uid())::text = (storage.foldername(name))[1]
         OR (public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
             AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)))
  );
DROP POLICY IF EXISTS "Users can view own progress photos files" ON storage.objects;
CREATE POLICY "Users can view own progress photos files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'progress-photos'
    AND ((auth.uid())::text = (storage.foldername(name))[1]
         OR (public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
             AND public.shares_tenant_with_me(((storage.foldername(name))[1])::uuid)))
  );

-- ジムの画像（ロゴ等）… 自分のジムのフォルダに、自分のジムのスタッフだけ
DROP POLICY IF EXISTS "Trainers can delete gym assets" ON storage.objects;
CREATE POLICY "Trainers can delete gym assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'gym-assets'
    AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
    AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
  );
DROP POLICY IF EXISTS "Trainers can update gym assets" ON storage.objects;
CREATE POLICY "Trainers can update gym assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'gym-assets'
    AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
    AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
  );
DROP POLICY IF EXISTS "Trainers can upload gym assets" ON storage.objects;
CREATE POLICY "Trainers can upload gym assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'gym-assets'
    AND public.has_tenant_role(public.get_my_tenant_id(), auth.uid(), ARRAY['owner', 'trainer'])
    AND (storage.foldername(name))[1] = (public.get_my_tenant_id())::text
  );

-- ----------------------------------------------------------------------------
-- 6. 関数
-- ----------------------------------------------------------------------------

-- お客様の予約の削除の制限（消化扱い・過去の予約・当日）。スタッフは素通り。
-- 今までは印を持つお客様も素通りだった（自分の過去の予約を消して、消化数を減らせた）
CREATE OR REPLACE FUNCTION public.enforce_booking_same_day_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_penalty boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;

  IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN
    RETURN OLD;
  END IF;

  IF OLD.status = '同日キャンセル済み' THEN
    RAISE EXCEPTION '消化扱いの予約は削除できません。'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 過去日(JST)の予約は顧客削除不可（消化数の事後改ざん防止）
  IF (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
       < (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION '過去の予約は削除できません。'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
       <> (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RETURN OLD;
  END IF;

  SELECT t.same_day_cancel_penalty_enabled INTO v_penalty
  FROM public.tenants t WHERE t.id = OLD.tenant_id;

  IF COALESCE(v_penalty, false) THEN
    RAISE EXCEPTION '当日の予約は消化扱いとなるため、この方法では削除できません。アプリの操作をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$function$;

-- お客様の予約の変更の制限（直接のキャンセル・消化扱いからの戻し）。スタッフは素通り。
CREATE OR REPLACE FUNCTION public.enforce_booking_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_tenant_role(OLD.tenant_id, auth.uid(), ARRAY['owner', 'trainer']) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'キャンセル済み' AND OLD.status IS DISTINCT FROM 'キャンセル済み' THEN
    RAISE EXCEPTION 'この操作は許可されていません。アプリのキャンセル/変更機能をご利用ください。'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 消化(同日キャンセル済み)からの遷移は予約日当日(JST)のみ許可
  IF OLD.status = '同日キャンセル済み'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.booking_date AT TIME ZONE 'Asia/Tokyo')::date
           <> (now() AT TIME ZONE 'Asia/Tokyo')::date THEN
    RAISE EXCEPTION '消化扱いの予約は変更できません。'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- お客様を招く招待コード（スタッフの画面の「招待コード」カード）
CREATE OR REPLACE FUNCTION public.get_my_tenant_invite_code()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT t.invite_code
  FROM public.tenants t
  WHERE t.id = public.get_my_tenant_id()
    AND (t.owner_user_id = auth.uid() OR public.has_tenant_role(t.id, auth.uid(), ARRAY['owner', 'trainer']))
$function$;

-- 2026-09-05 に表ごと消したゲーム機能（装備）の関数の残り。表が無いので呼ぶとエラーになるだけだが、
-- 中身が印の判定で、うち1本は未ログインでも呼べる状態だった。呼び出し元は無い（画面・関数・トリガーとも）。
DROP FUNCTION IF EXISTS public.equip_item(uuid, uuid);
DROP FUNCTION IF EXISTS public.equip_item_unchecked(uuid, uuid);
DROP FUNCTION IF EXISTS public.initialize_starter_equipment();
DROP FUNCTION IF EXISTS public.initialize_starter_equipment_for_user(uuid);
