-- ============================================================================
-- 課金の印を運営だけのものにし、ジムの課金・契約の列を画面から書き換えられないようにする（2026-10-31）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい」。Stripe の2件は宗本さんの判断（2026-10-31）:
--   - テスト決済（Stripe のテストモード）は、運営が指定したテスト用のジムだけ
--   - 「運営が無償で無制限にしているジム（コンプ）」は専用の印で見分ける。印は御所南だけに付ける
--
-- ■ 何が起きていたか
-- 1. テスト決済で本番のジムのプランが変わった（gymboard-stripe-webhook-1）
--    gymboard-create-checkout は environment = 'sandbox' を誰からでも受け付け（本番以外のホストでは画面が自動で
--    sandbox を選ぶ。本番でも ?stripe_env=sandbox で選べる）、webhook はテストモードのイベントでも本番の
--    tenants を書き換えていた。どのジムのオーナーでも、テスト用のカード番号（お金が動かない）で Pro を
--    「契約」して上限なしにできた。
-- 2. Pro がコンプ扱いになった（gymboard-stripe-webhook-2）
--    webhook はコンプを max_customers IS NULL で見分けていた。Pro も上限なし（NULL）なので、Pro になった
--    ジムは以後のイベント（解約・プラン変更）を全部無視され、解約しても Pro のまま残った。
-- 3. オーナーが自分のジムの課金・契約の列を書き換えられた（このマイグレーションを書く途中で見つけた）
--    tenants の UPDATE のポリシーは「自分がオーナーの行」しか見ず、列は見ていない。以前の
--    REVOKE UPDATE (stripe_customer_id, stripe_subscription_id) は**効いていなかった**（テーブル単位の
--    権限が残っていると、列単位の REVOKE は何もしない。穴6 と同じ形）。本番で authenticated は全列を
--    UPDATE できた → API を直接叩けば gymboard_plan = 'premium'・max_customers = NULL（上限なし）・
--    お試し期間の延長ができた。直接の INSERT（ポリシー "Authenticated users can create tenant"）でも
--    同じ値でジムを開けた（create_gym_with_owner は値を固定しているが、INSERT の道が残っていた）。
--
-- ■ 直し方
-- (A) 1・2 の印は、運営だけが触れる別の表 tenant_billing_flags に置く。anon・authenticated は読めない・
--     書けない（Edge Function の service_role と、運営の SQL だけ）。tenants の列にすると、3 と同じ形で
--     画面から書けてしまうため。
--       is_comp                … コンプ。Stripe のイベントで一切書き換えない（2026-08-21 の事故の再発防止は維持）
--       stripe_sandbox_allowed … テスト決済を受け付けるテスト用のジム
--     どのジムに印を付けるかは運営が本番の SQL で決める（ジムの ID はリポジトリに書かない。公開リポジトリのため）。
--     🔴 本番では、関数（webhook）を差し替える**前に**御所南へ is_comp を付けること。付ける前に新しい webhook が
--        動くと、御所南が Stripe のイベントで落ちうる（2026-08-21 と同じ事故）。
-- (B) 3 は BEFORE INSERT OR UPDATE のトリガーで塞ぐ。列 GRANT の許可リストにすると、Lovable が設定の列を
--     足すたびに画面の保存が黙って落ちるので、守る列の拒否リストにする。
--       - 画面から（current_user が authenticated / anon）の UPDATE: 守る列が変わるなら拒む（同じ値なら通す）
--       - 画面からの INSERT: 守る列を create_gym_with_owner と同じ値に上書きする（拒まない。古いアプリは
--         開設のときにこれらの列を送っていたため。開設そのものは今まで通りできる）
--       - service_role（webhook・checkout）と SECURITY DEFINER の関数（create_gym_with_owner・オーナーの
--         引き継ぎ・定時の処理。所有者の権限で動く）は対象外
--     画面が今これらの列を書いている所は無い（src/ の tenants への update を全部確かめた）。
--     🔴 門番の関数は SECURITY INVOKER（current_user で「画面から」を見分ける。DEFINER にすると素通り）。
--
-- 見張り: src/test/stripeBillingFlags.test.ts・src/test/stripeWebhookCompGuard.test.ts・security/check.sql の検査13
-- ============================================================================

-- (A) 運営だけが触れる課金の印
CREATE TABLE IF NOT EXISTS public.tenant_billing_flags (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_comp boolean NOT NULL DEFAULT false,
  stripe_sandbox_allowed boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_billing_flags IS
  '運営が付ける課金の印（2026-10-31）。anon・authenticated は読めない・書けない。'
  'is_comp = 運営が無償で無制限にしているジム（Stripe のイベントで書き換えない）。'
  'stripe_sandbox_allowed = テスト決済を受け付けるテスト用のジム（それ以外はテストモードを使えない・反映しない）。';

ALTER TABLE public.tenant_billing_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_billing_flags FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_billing_flags TO service_role;

-- (B) ジムの課金・契約の列は、画面から書き換えられない
CREATE OR REPLACE FUNCTION public.guard_tenant_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- service_role（Stripe の webhook・checkout）と SECURITY DEFINER の関数（所有者の権限で動く）は対象外
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- create_gym_with_owner と同じ値に固定する（拒まない。古いアプリは開設のときにこれらの列を送っていた）
    NEW.status                 := 'trial';
    NEW.trial_ends_at          := now() + interval '60 days';
    NEW.gymboard_plan          := 'free';
    NEW.gymboard_plan_period   := NULL;
    NEW.max_customers          := 5;
    NEW.max_trainers           := NULL;
    NEW.subscription_status    := NULL;
    NEW.current_period_end     := NULL;
    NEW.stripe_customer_id     := NULL;
    NEW.stripe_subscription_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status                 IS DISTINCT FROM OLD.status
  OR NEW.trial_ends_at          IS DISTINCT FROM OLD.trial_ends_at
  OR NEW.gymboard_plan          IS DISTINCT FROM OLD.gymboard_plan
  OR NEW.gymboard_plan_period   IS DISTINCT FROM OLD.gymboard_plan_period
  OR NEW.max_customers          IS DISTINCT FROM OLD.max_customers
  OR NEW.max_trainers           IS DISTINCT FROM OLD.max_trainers
  OR NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status
  OR NEW.current_period_end     IS DISTINCT FROM OLD.current_period_end
  OR NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
  OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
  OR NEW.owner_user_id          IS DISTINCT FROM OLD.owner_user_id THEN
    RAISE EXCEPTION 'プラン・契約の状態は、この画面からは変えられません' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tenant_billing_columns ON public.tenants;
CREATE TRIGGER trg_guard_tenant_billing_columns
  BEFORE INSERT OR UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_billing_columns();

-- (C) ジムを閉じるとき（delete_my_gym）に、印も消す
--     外部キーの ON DELETE CASCADE でも消えるが、全テーブルを明示的に消す、がこの関数の決まり。
--     🔴 定義は本番の pg_get_functiondef（2026-10-31 時点・md5 66ae5d8ba27ef4e6c6518fc4e004a36e）から**機械的に写し**、
--        tenant_billing_flags の1行だけを tenant_staff_invites の直後に足してある。
--        古い版から書き直すと、その間に増えたテーブルの消し込みが黙って消える。
--     見張り: src/test/gymOwnership.test.ts「テナント配下のテーブルを取りこぼしていない」
CREATE OR REPLACE FUNCTION public.delete_my_gym()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_tenant_id UUID;
  v_others    INT;
  v_owned     INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*), (array_agg(tenant_id))[1] INTO v_owned, v_tenant_id
    FROM public.tenant_members
   WHERE user_id = v_uid AND role = 'owner' AND status = 'active';

  IF v_owned = 0 THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_owned > 1 THEN
    RAISE EXCEPTION 'ambiguous_tenant:%', v_owned USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_others
    FROM public.tenant_members
   WHERE tenant_id = v_tenant_id
     AND user_id <> v_uid
     AND status = 'active';

  IF v_others > 0 THEN
    RAISE EXCEPTION 'members_remain:%', v_others USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.announcement_reads
   WHERE announcement_id IN (SELECT id FROM public.announcements WHERE tenant_id = v_tenant_id);
  DELETE FROM public.announcement_audience WHERE tenant_id = v_tenant_id;

  DELETE FROM public.member_agreements   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_reactions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.messages            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.message_templates   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.gym_videos          WHERE tenant_id = v_tenant_id;
  DELETE FROM public.operator_feedback   WHERE tenant_id = v_tenant_id;

  DELETE FROM public.workouts            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercise_id_map     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.exercises           WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_muscle_groups WHERE tenant_id = v_tenant_id;

  DELETE FROM public.booking_waitlist    WHERE tenant_id = v_tenant_id;
  DELETE FROM public.bookings            WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_notify_log  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.email_send_log     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.blocked_slots       WHERE tenant_id = v_tenant_id;
  DELETE FROM public.trial_bookings      WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_questions   WHERE tenant_id = v_tenant_id;
  DELETE FROM public.staff_schedules     WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_frequency_limits WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_capacity_windows WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_blocked_windows WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_closed_days  WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_uncapped_days WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_option_customers WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_options      WHERE tenant_id = v_tenant_id;
  DELETE FROM public.booking_menus        WHERE tenant_id = v_tenant_id;

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
  DELETE FROM public.tenant_staff_invites WHERE tenant_id = v_tenant_id;
  DELETE FROM public.tenant_billing_flags WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenant_members      WHERE tenant_id = v_tenant_id;

  UPDATE public.profiles SET tenant_id = NULL WHERE tenant_id = v_tenant_id;

  DELETE FROM public.tenants WHERE id = v_tenant_id;
END;
$function$;
