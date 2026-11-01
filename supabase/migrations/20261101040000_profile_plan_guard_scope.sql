-- ============================================================================
-- お客様が自分の契約の列（プラン・起算日など）を書き換えて、回数の上限や入金の確認をすり抜けられた穴を塞ぐ（2026-11-01）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。点検の拡大
-- profiles-plan-guard-1（反証役が「通る」と判断）。
--
-- 契約の列（plan・cycle_start_date・cycle_start_pinned・grace_enabled）は profiles にあり、人ごとに1行で
-- **全部のジムで共通**。予約の回数の上限（GB004）と次回分の入金の確認（GB009）はこの列を読む。
--
-- ■ 何が起きていたか（guard_profile_plan_fields）
-- A) 本人の行は「どこかのジムのスタッフなら素通し」だった。tenants の INSERT は誰でもできるので、お客様が
--    自分でジムを1つ作ってオーナーになれば、元のジムのお客様のまま、プランを消す・存在しない名前にする・
--    起算日を消す、ができ、上限と入金の確認をすり抜けて予約できた。
-- B) 2つ目のアカウントでも同じことができた: 2つ目でジムを作り、1つ目をそのジムのお客様にすれば、
--    2つ目は「1つ目の店のスタッフ」として、1つ目の（全部のジムで共通の）契約の列を書き換えられた。
-- C) 起算日は「値がある行を変える」のを、固定されたお客様と上限を強制するプランでしか止めていなかった。
--    それ以外のお客様は自分で起算日を消せ（member_first_unpaid_cycle_start が NULL を返し、入金の確認が
--    効かない）、前へ戻すことも、予約の無い日にすることもできた。
--
-- ■ 直し方（本番の pg_get_functiondef から写し、3か所だけ足す。他は1文字も変えない）
-- 1. 他人の行（店・インストラクターによる変更）: そのお客様が「自分がスタッフをしていないジム」にも
--    お客様として在籍しているなら、契約の列は変えさせない（共通の列なので、他のジムの契約まで変わる）。
-- 2. 本人の行の素通しは「スタッフで、しかもお客様としての所属がどこにも無い人」だけ（status を問わず）。
-- 3. 本人による起算日の変更は、アプリの自動設定（src/hooks/useBookings.ts の rebaseCycleStartIfNeeded）と
--    同じ形だけを通す: 消さない・前へ戻さない・今日より前にしない・自分の予約（キャンセル済み以外）がある日にする。
--    アプリは予約を入れた直後に、その予約の日付（JST）を入れるので、正規の動きはすべてこの形に入る。
--
-- 本番（2026-11-01）: 2つ以上のジムに通っているお客様は0人、スタッフとお客様を兼ねている人は0人、
-- 次回分の入金の確認を ON にしているジムは0件。今の利用者で動きが変わる人はいない。
-- 将来2つのジムに通うお客様が出たら、どちらの店からも契約の列は変えられない（運営が直す）。根本は契約の列を
-- 所属（tenant_members）ごとに持つこと（mem/ops/tenant-boundary.md 穴21）。
--
-- 見張り: src/test/profilePlanGuard.test.ts
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_profile_plan_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_limited boolean;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  v_limited := v_actor IS DISTINCT FROM NEW.user_id AND EXISTS (
    SELECT 1 FROM public.tenant_members me
      JOIN public.tenant_members target ON target.tenant_id = me.tenant_id
     WHERE me.user_id = v_actor
       AND me.status = 'active' AND me.role = 'trainer' AND me.staff_access = 'limited'
       AND target.user_id = NEW.user_id
  );

  -- 他人の行（店・インストラクターによる変更）: 契約の列は全部のジムで共通なので、そのお客様が
  -- 自分がスタッフをしていないジムにもお客様として在籍しているなら変えさせない（2026-11-01）。
  -- 🔴 2つ目のアカウントでジムを作り、1つ目をそのお客様にすると、元のジムの契約を書き換えられた。
  IF v_actor IS DISTINCT FROM NEW.user_id
     AND (NEW.plan IS DISTINCT FROM OLD.plan
       OR NEW.grace_enabled IS DISTINCT FROM OLD.grace_enabled
       OR NEW.cycle_start_pinned IS DISTINCT FROM OLD.cycle_start_pinned
       OR NEW.cycle_start_date IS DISTINCT FROM OLD.cycle_start_date)
     AND EXISTS (
       SELECT 1 FROM public.tenant_members c
        WHERE c.user_id = NEW.user_id AND c.role = 'customer' AND c.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM public.tenant_members s
             WHERE s.user_id = v_actor AND s.tenant_id = c.tenant_id
               AND s.status = 'active' AND s.role IN ('owner', 'trainer')
          )
     ) THEN
    RAISE EXCEPTION 'このお客様のご契約は、ここでは変更できません（運営にお問い合わせください）'
      USING ERRCODE = 'GB005';
  END IF;

  IF NOT v_limited THEN
    IF v_actor IS DISTINCT FROM NEW.user_id THEN
      RETURN NEW;
    END IF;

    -- 本人の行: スタッフで、しかもお客様としての所属がどこにも無い人だけ素通し（2026-11-01）。
    -- 🔴 お客様が自分でジムを作れば「どこかのスタッフ」になれるので、それだけでは通さない。
    IF EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.user_id = v_actor AND tm.status = 'active'
         AND tm.role IN ('owner', 'trainer')
    ) AND NOT EXISTS (
      SELECT 1 FROM public.tenant_members c
       WHERE c.user_id = v_actor AND c.role = 'customer'
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 契約の中身は本人には変えさせない（cycle_start_pinned も店だけが操作できる）
  IF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.grace_enabled IS DISTINCT FROM OLD.grace_enabled
     OR NEW.cycle_start_pinned IS DISTINCT FROM OLD.cycle_start_pinned THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  -- 起算日（本人）: アプリの自動設定と同じ形だけ（2026-11-01）。
  --   消さない・前へ戻さない・今日（JST）より前にしない・自分の予約（キャンセル済み以外）がある日にする。
  IF v_actor = NEW.user_id
     AND NEW.cycle_start_date IS DISTINCT FROM OLD.cycle_start_date
     AND (
       NEW.cycle_start_date IS NULL
       OR NEW.cycle_start_date < OLD.cycle_start_date
       OR NEW.cycle_start_date < (now() AT TIME ZONE 'Asia/Tokyo')::date
       OR NOT EXISTS (
         SELECT 1 FROM public.bookings b
          WHERE b.user_id = NEW.user_id
            AND b.status <> 'キャンセル済み'
            AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = NEW.cycle_start_date
       )
     ) THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  -- 起算日: NULL → 値の初回設定は許す。既に値がある行の変更は、
  --   (a) 店が起算日を固定しているお客様（cycle_start_pinned）… 常に拒否
  --   (b) 上限を強制しているプラン（allow_overflow=false）… 従来どおり拒否
  IF NEW.cycle_start_date IS DISTINCT FROM OLD.cycle_start_date
     AND OLD.cycle_start_date IS NOT NULL
     AND (
       OLD.cycle_start_pinned
       OR EXISTS (
         SELECT 1 FROM public.tenant_plans tp
          WHERE tp.plan_name = OLD.plan
            AND tp.allow_overflow = false
            AND tp.tenant_id IN (
              SELECT tm.tenant_id FROM public.tenant_members tm
               WHERE tm.user_id = OLD.user_id AND tm.status = 'active')
       )
     ) THEN
    RAISE EXCEPTION 'ご契約の内容はご自身では変更できません'
      USING ERRCODE = 'GB005';
  END IF;

  RETURN NEW;
END;
$function$;
