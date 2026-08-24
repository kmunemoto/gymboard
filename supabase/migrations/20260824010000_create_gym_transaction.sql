-- ジム開設を1トランザクションにまとめる（2026-08-24）
--
-- ## なぜ
--
-- これまで Onboarding.tsx が8ステップを**クライアントから逐次書き込み**していた。
-- 途中で失敗しても巻き戻しが1行も無いため、実害が3つ出ていた:
--
--   1. tenants だけ残る「孤児テナント」。しかも再試行は毎回 tenants の INSERT から
--      始まるので、押すたびにテナントが1行ずつ増える。
--      既存判定は tenant_members で行っているため孤児は検出されない。
--   2. tenant_members の INSERT で失敗すると、本人が非メンバーのまま残る。
--      delete_my_gym は「自分が owner として在籍していること」で本人確認するので、
--      **その孤児テナントは本人にもアプリからも消せない。**
--   3. 🔴 部位マスターのシードが**必ず失敗していた**（下記）。
--
-- 本番で実際にこうなっていた（2026-08-24 時点）:
--   - 孤児テナント 1件（tenant_members が0件）
--   - 部位マスター0件のテナント 6件（2026-07-29 以降に開設された**全部**）
--
-- ## 🔴 部位シードの恒常バグ
--
-- tenant_muscle_groups の INSERT ポリシーは `tenant_id = get_my_tenant_id()` を要求し、
-- get_my_tenant_id() は **tenant_members の在籍行を読む**。
-- ところが Onboarding.tsx はシードを tenant_members の INSERT より**前**に置いていたため、
-- この INSERT は常に WITH CHECK 違反で弾かれていた。エラーは console.error で
-- 握りつぶされるので誰も気づけない（コメントには「ここで作らないと0件になる」と
-- 書いてあるのに、まさにその状態だった）。
--
-- RPC は SECURITY DEFINER なので RLS を通らず、順序の問題自体が消える。
--
-- ## 方針
--
-- - 作成系はこの関数1本に集約する。クライアントは列を組み立てて渡すだけ
-- - 途中で失敗したら**関数ごとロールバック**＝孤児が原理的に発生しない
--   （再試行で増える問題も自然に消える）
-- - 削除・移譲は既に RPC 化済み（20260813010000）。作成側がこれで揃う

-- ===========================================================================
-- 1. ジム開設 RPC
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_gym_with_owner(
  _tenant        JSONB,          -- tenants に入れる列（クライアントが組み立てる）
  _plans         JSONB DEFAULT '[]'::jsonb,  -- tenant_plans の配列。空でよい
  _owner_name    TEXT  DEFAULT NULL,         -- オーナーの表示名
  _muscle_groups TEXT[] DEFAULT NULL         -- 部位の既定値。NULL なら入れない
)
RETURNS TABLE (tenant_id UUID, invite_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_tenant public.tenants%ROWTYPE;
  v_plan   JSONB;
  v_name   TEXT;
  v_idx    INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 🔴 開設できるのはトレーナーだけ。お客様のアカウントからジムを増やせないようにする
  --    （user_roles は signup-trainer / AuthContext が付与する。ここでは確認だけ）
  IF NOT public.has_role(v_uid, 'trainer'::public.app_role) THEN
    RAISE EXCEPTION 'not_trainer' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 🔴 プラン状態はクライアントに決めさせない。
  --    これまでは gymboard_plan / max_customers / status / trial_ends_at を
  --    クライアントが INSERT のボディで送っており、API を直接叩けば
  --    premium・上限999 で開設できた。ここで固定する。
  INSERT INTO public.tenants (
    gym_name, business_type, address, phone, email, website_url, logo_url,
    primary_color, operating_hours, slot_duration_minutes, booking_capacity,
    booking_capacity_confirmed_at, booking_cutoff_type, booking_cutoff_hours,
    owner_user_id, status, trial_ends_at, gymboard_plan, max_customers
  )
  VALUES (
    NULLIF(btrim(_tenant->>'gym_name'), ''),
    -- business_type は NOT NULL かつ CHECK 付き（personal_gym/pilates/yoga/seitai/other）。
    -- 画面は必ず選ばせるが、渡ってこなくても落ちないよう 'other' に倒す
    coalesce(NULLIF(btrim(coalesce(_tenant->>'business_type', '')), ''), 'other'),
    NULLIF(btrim(coalesce(_tenant->>'address', '')), ''),
    NULLIF(btrim(coalesce(_tenant->>'phone', '')), ''),
    NULLIF(btrim(coalesce(_tenant->>'email', '')), ''),
    NULLIF(btrim(coalesce(_tenant->>'website_url', '')), ''),
    NULLIF(btrim(coalesce(_tenant->>'logo_url', '')), ''),
    _tenant->>'primary_color',
    coalesce(_tenant->'operating_hours', '{"start":"09:00","end":"21:00"}'::jsonb),
    coalesce((_tenant->>'slot_duration_minutes')::int, 60),
    coalesce((_tenant->>'booking_capacity')::int, 1),
    now(),                                   -- 開設時に明示的に聞いているので確認済み
    coalesce(_tenant->>'booking_cutoff_type', 'hours_before'),
    coalesce((_tenant->>'booking_cutoff_hours')::int, 24),
    v_uid,
    'trial',                                 -- ← 以下4つはサーバー側で固定
    now() + interval '60 days',
    'free',
    5
  )
  RETURNING * INTO v_tenant;

  -- 在籍（owner）。🔴 部位シードより**先**に入れること。
  --    RPC 自体は RLS を通らないので順序に依存しないが、
  --    「オーナーが居ないテナントを作らない」ことを構造として示しておく。
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, display_name)
  VALUES (v_tenant.id, v_uid, 'owner', 'active', _owner_name);

  -- 会員プラン（任意。空の配列でよい）
  IF _plans IS NOT NULL AND jsonb_typeof(_plans) = 'array' THEN
    FOR v_plan IN SELECT * FROM jsonb_array_elements(_plans) LOOP
      CONTINUE WHEN NULLIF(btrim(coalesce(v_plan->>'plan_name', '')), '') IS NULL;
      v_idx := v_idx + 1;
      INSERT INTO public.tenant_plans (
        tenant_id, plan_name, plan_type, max_sessions, price, validity_days, sort_order
      ) VALUES (
        v_tenant.id,
        btrim(v_plan->>'plan_name'),
        coalesce(v_plan->>'plan_type', 'subscription'),
        (v_plan->>'max_sessions')::int,
        coalesce((v_plan->>'price')::int, 0),
        (v_plan->>'validity_days')::int,
        v_idx
      );
    END LOOP;
  END IF;

  -- 部位マスター（レーダーチャート・種目管理で使う）
  IF _muscle_groups IS NOT NULL THEN
    v_idx := 0;
    FOREACH v_name IN ARRAY _muscle_groups LOOP
      INSERT INTO public.tenant_muscle_groups (tenant_id, name, sort_order)
      VALUES (v_tenant.id, v_name, v_idx);
      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- オーナーの profiles。
  -- ⚠️ auth.users の INSERT トリガーは**本番に存在しない**（意図的にそうしている。
  --    mem/auth/social-login.md）。ここで作らないとオーナーの profiles が欠ける
  --    （2026-08-08 に14人ぶん欠けていた事故の再発防止）。
  INSERT INTO public.profiles (user_id, display_name, tenant_id)
  VALUES (v_uid, _owner_name, v_tenant.id)
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = coalesce(EXCLUDED.display_name, public.profiles.display_name),
        tenant_id    = EXCLUDED.tenant_id;

  RETURN QUERY SELECT v_tenant.id, v_tenant.invite_code;
END;
$$;

REVOKE ALL ON FUNCTION public.create_gym_with_owner(JSONB, JSONB, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_gym_with_owner(JSONB, JSONB, TEXT, TEXT[]) TO authenticated;

COMMENT ON FUNCTION public.create_gym_with_owner(JSONB, JSONB, TEXT, TEXT[]) IS
  'ジム開設を1トランザクションで行う。途中失敗で孤児テナントが残らない。'
  'プラン状態（trial/free/上限5）はサーバー側で固定し、クライアントの申告を採らない。';

-- ===========================================================================
-- 2. 部位マスター0件のテナントをバックフィルする
-- ===========================================================================
--
-- 上記のバグで、2026-07-29 以降に開設されたテナントは部位が0件のまま。
-- 20260723080000 のバックフィルと同じ並びで入れ直す。
-- 冪等: 既に1件でもあるテナントには触らない。

INSERT INTO public.tenant_muscle_groups (tenant_id, name, sort_order)
SELECT t.id, g.name, g.ord
  FROM public.tenants t
 CROSS JOIN (
   VALUES ('胸', 0), ('背中', 1), ('肩', 2), ('脚', 3),
          ('お尻', 4), ('二頭筋', 5), ('三頭筋', 6), ('腹筋', 7)
 ) AS g(name, ord)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.tenant_muscle_groups m WHERE m.tenant_id = t.id
 );
