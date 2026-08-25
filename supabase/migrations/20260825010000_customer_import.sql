-- 顧客の一括登録（CSV）— 取り込みの受け皿
--
-- ## なぜ「裏でアカウントを作る」形にしたか
--
-- 他ジムから乗り換えてくるとき、名簿の大半は「まだアプリを入れていない人」なので、
-- 店だけが持つ未招待の顧客を作れる必要がある。素直に考えると
-- profiles.user_id を NULL 許容にする案になるが、**それでは成立しない**。
-- 本番を実測した結果:
--
--   1. 顧客一覧は profiles ではなく tenant_members を起点に作っている
--      （src/hooks/useProfile.ts:198-271）。tenant_members.user_id は NOT NULL かつ
--      FK → auth.users なので、アカウントの無い顧客は**一覧に1件も出ない**
--   2. 予約を入れようとすると、bookings の BEFORE INSERT トリガ
--      ensure_customer_on_booking が profiles と user_roles に INSERT する。
--      どちらも user_id が FK → auth.users なので、実体の無い uuid では必ず落ちる
--   3. 人数上限（enforce_tenant_member_limits）は tenant_members を数えるので、
--      アカウント無しの顧客は上限に当たらない＝課金の根拠が崩れる
--
-- そこで、取り込み時に**ログイン手段を持たない auth のアカウント**を1件ずつ作る。
-- DB から見れば普通の顧客なので、一覧・カルテ・予約・記録・プラン上限・削除・RLS が
-- **1行も直さずにそのまま動く**。乗り換え元の来店履歴や回数券残も後から入れられる。
--
-- 「未招待」は状態として持つ（下の2列）。店が招待を送り、本人がログインした時点で
-- claimed_at が入る。氏名照合で突き合わせないので、他人のカルテが見える事故が起きない。

-- ---------------------------------------------------------------------------
-- 1. 取り込みの跡
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at  timestamptz;

COMMENT ON COLUMN public.profiles.imported_at IS
  'CSV 一括登録で作られた行なら、その時刻。手で入会した顧客は NULL。';
COMMENT ON COLUMN public.profiles.claimed_at IS
  '本人が実際にログインした時刻。imported_at があって claimed_at が NULL の間が「未招待」。';

-- 未招待の顧客を一覧で数える／絞るための索引（取り込んだ行だけ載る部分索引）
CREATE INDEX IF NOT EXISTS profiles_unclaimed_idx
  ON public.profiles (tenant_id)
  WHERE imported_at IS NOT NULL AND claimed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. 取り込み本体
-- ---------------------------------------------------------------------------

-- 1回の呼び出しで全行を入れる。**途中で失敗したら1件も入らない**。
--
-- 部分適用を許すと、店は「何人入ったのか」を数え直せない（名簿は数百件ある）。
-- 人数上限に当たる場合もここで丸ごと止まるので、上限を超えた取り込みが
-- 中途半端に残らない。
--
-- 🔴 この関数は auth のアカウントを作らない（SQL からは作れない）。
--    アカウントは Edge Function（import-customers）が service_role で先に作り、
--    その user_id を各行に載せて渡す。したがって **service_role からのみ実行できる**。
--    authenticated から呼べると、他人の user_id を自テナントに引き込めてしまう。
CREATE OR REPLACE FUNCTION public.import_customers(
  _tenant_id UUID,
  _rows      JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row   JSONB;
  v_user  UUID;
  v_count INTEGER := 0;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF _rows IS NULL OR jsonb_typeof(_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    v_user := NULLIF(v_row->>'user_id', '')::UUID;
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'user_id_required' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- 人の情報。tenant_id もここで必ず入れる
    -- （書き出しが profiles.tenant_id を見ていた時期があり、空だと名前が出ない）
    INSERT INTO public.profiles (
      user_id, tenant_id, display_name, name_kana, phone, plan, imported_at
    ) VALUES (
      v_user,
      _tenant_id,
      NULLIF(btrim(coalesce(v_row->>'display_name', '')), ''),
      NULLIF(btrim(coalesce(v_row->>'name_kana', '')), ''),
      NULLIF(btrim(coalesce(v_row->>'phone', '')), ''),
      NULLIF(btrim(coalesce(v_row->>'plan', '')), ''),
      now()
    );

    -- 在籍。ここが顧客一覧の起点なので、これが無いと店の画面に出ない。
    -- 人数上限のトリガ（enforce_tenant_member_limits）もこの INSERT で効く
    INSERT INTO public.tenant_members (
      tenant_id, user_id, role, display_name, status, joined_at
    ) VALUES (
      _tenant_id,
      v_user,
      'customer',
      NULLIF(btrim(coalesce(v_row->>'display_name', '')), ''),
      coalesce(NULLIF(btrim(coalesce(v_row->>'status', '')), ''), 'active'),
      coalesce(NULLIF(v_row->>'joined_at', '')::TIMESTAMPTZ, now())
    );

    -- 役割。ensure_customer_on_booking が予約時に入れるのと同じ行を先に作っておく
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user, 'customer')
    ON CONFLICT (user_id, role) DO NOTHING;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_customers(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 本人が来たことを記録する
-- ---------------------------------------------------------------------------

-- 取り込んだ顧客が実際にログインしたら「未招待」を外す。
--
-- 本人しか自分の行を触れないので、引数は取らない（auth.uid() だけを見る）。
-- 既に claimed_at が入っている行は触らないので、何度呼んでも安全。
CREATE OR REPLACE FUNCTION public.claim_my_profile()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
     SET claimed_at = now()
   WHERE user_id = v_uid
     AND imported_at IS NOT NULL
     AND claimed_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_my_profile() TO authenticated;
