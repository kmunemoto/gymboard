-- ジム側で「スタッフを追加する」導線を作る。
--
-- 背景: これまでスタッフ（trainer）を増やす手段がアプリに無かった。
-- 20260803120000_tenant_members_write_scope.sql で「他人の tenant_members 行を作る」
-- 経路を塞いだため（塞ぐ前も導線は無かった）、追加は Supabase ダッシュボードから
-- 手作業でやるしかない状態だった。トレーナーが複数いるジムでは実運用に耐えない。
--
-- ## 方式: スタッフ専用の招待コード
--
-- お客様の招待コード（tenants.invite_code）とは**別のコード**を持つ。
-- 同じコードを兼用すると「お客様として配ったリンクからスタッフになれる」ことになり、
-- 顧客データ全件が見える権限が漏れる。用途が違うものは別の鍵にする。
--
-- 加入は SECURITY DEFINER の RPC 経由のみ。理由:
--   - RLS の "Users can insert own membership" は role='customer' か
--     「自分がオーナーのテナントの owner」しか許していない（自己昇格の防止）。
--     trainer を自分で insert することはできないし、できるようにもしたくない。
--   - RPC なら「正しいコードを知っている」ことを条件にできる。
--
-- コードの長さは gen_random_bytes(8)=16桁hex（64bit）。お客様用の 4バイト(8桁) より
-- 長くしているのは、スタッフ権限は顧客データ全件が見える＝漏れたときの被害が桁違いのため。
-- リンクをコピーして渡す使い方なので、桁数が増えても運用は重くならない。

-- ============================================================
-- 1) 列とコード生成
-- ============================================================
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS staff_invite_code text;

COMMENT ON COLUMN public.tenants.staff_invite_code IS
  'スタッフ（trainer）加入用の招待コード。お客様用の invite_code とは別物で、これを知っているとスタッフとして参加できる。読み出しは get_my_staff_invite_code()（オーナーのみ）経由。';

CREATE UNIQUE INDEX IF NOT EXISTS tenants_staff_invite_code_key
  ON public.tenants (staff_invite_code)
  WHERE staff_invite_code IS NOT NULL;

-- 顧客用 invite_code と同じく、テーブル直読みでは見えないようにする
-- （20260527091722 と同じ作法）。参照は下の RPC 経由。
REVOKE SELECT (staff_invite_code) ON public.tenants FROM authenticated;
REVOKE SELECT (staff_invite_code) ON public.tenants FROM anon;

-- ⚠️ search_path に extensions を含めること。
-- gen_random_bytes は pgcrypto の関数で、Supabase では **public ではなく
-- extensions スキーマ**に入っている。`SET search_path = public` だけだと
--   ERROR 42883: function gen_random_bytes(integer) does not exist
-- でマイグレーションごと落ちる（2026-08-04 に本番適用で実際に踏んだ）。
--
-- 既存の tenants.invite_code は列 DEFAULT で gen_random_bytes を使っていて動くが、
-- あちらは search_path を固定していないため気づけなかった。
--
-- extensions を足す形にしているのは、フォークによって pgcrypto の置き場所が
-- public のこともあるため（どちらでも解決できる）。存在しないスキーマが
-- search_path にあっても Postgres は黙って無視するので安全。
CREATE OR REPLACE FUNCTION public._gen_staff_invite_code()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  SELECT encode(gen_random_bytes(8), 'hex');
$$;

-- ============================================================
-- 2) オーナーがコードを見る / 作り直す
-- ============================================================
-- 初回は NULL なので、見に行ったタイミングで発行する（オーナーが設定画面を
-- 開いた時点で使える状態にする。「発行ボタンを押してから」だと一手増える）。
CREATE OR REPLACE FUNCTION public.get_my_staff_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT t.id, t.staff_invite_code INTO v_tenant_id, v_code
  FROM public.tenants t
  WHERE t.owner_user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN NULL;  -- オーナーでなければ何も返さない
  END IF;

  IF v_code IS NULL THEN
    v_code := public._gen_staff_invite_code();
    UPDATE public.tenants SET staff_invite_code = v_code WHERE id = v_tenant_id;
  END IF;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_staff_invite_code() TO authenticated;

-- 漏れたと思ったら作り直せるようにする。古いコードは即座に使えなくなる。
CREATE OR REPLACE FUNCTION public.regenerate_staff_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  WHERE t.owner_user_id = auth.uid()
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'この操作はジムのオーナーのみ行えます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_code := public._gen_staff_invite_code();
  UPDATE public.tenants SET staff_invite_code = v_code WHERE id = v_tenant_id;
  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.regenerate_staff_invite_code() TO authenticated;

-- ============================================================
-- 3) コードからジムを引く（加入前の確認画面用）
-- ============================================================
-- 返すのは「どのジムか分かる最小限」だけ。anon には渡さない
-- （加入にはログインが必要なので、未ログインで引ける必要が無い）。
CREATE OR REPLACE FUNCTION public.lookup_tenant_by_staff_invite_code(p_code text)
RETURNS TABLE (id uuid, gym_name text, address text, logo_url text, primary_color text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.gym_name, t.address, t.logo_url, t.primary_color
  FROM public.tenants t
  WHERE t.staff_invite_code = lower(replace(trim(p_code), '-', ''))
    AND t.status IN ('active', 'trial')
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_tenant_by_staff_invite_code(text) TO authenticated;

-- ============================================================
-- 4) スタッフとして加入する
-- ============================================================
-- 作るのは**自分の行だけ**。他人を巻き込む引数は受け取らない。
-- role は 'trainer' 固定（引数で受け取ると owner への昇格に使われる）。
--
-- user_roles にも trainer を入れる。アプリがジム側画面を出すかどうかは
-- user_roles（グローバルロール）で決めているため、これが無いとスタッフとして
-- 加入してもお客様画面のままになる。なお trainer ロールは新規登録時に誰でも
-- 選べる（＝自分で取れる）ロールなので、ここで付与しても権限は増えない。
-- **実際のジムへの所属は tenant_members が決める。**
CREATE OR REPLACE FUNCTION public.join_tenant_as_staff_with_invite_code(
  p_code text,
  p_display_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
  v_name text;
  v_existing_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_name := nullif(btrim(coalesce(p_display_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'お名前を入力してください' USING ERRCODE = 'check_violation';
  END IF;

  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  WHERE t.staff_invite_code = lower(replace(btrim(coalesce(p_code, '')), '-', ''))
    AND t.status IN ('active', 'trial')
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION '招待コードが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 既にこのジムのメンバーなら、役割によって扱いを分ける。
  -- オーナーはそのまま（降格させない）。お客様として在籍している人を
  -- 勝手にスタッフへ昇格させるのも危険なので、ここでは拒否して手動対応に倒す。
  SELECT tm.role INTO v_existing_role
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_tenant_id AND tm.user_id = v_uid;

  IF v_existing_role = 'owner' THEN
    RETURN v_tenant_id;  -- オーナーは元々スタッフ。何もせず成功扱い。
  ELSIF v_existing_role = 'customer' THEN
    RAISE EXCEPTION 'このアカウントはこのジムにお客様として登録されています。別のアカウントでお試しください'
      USING ERRCODE = 'check_violation';
  ELSIF v_existing_role = 'trainer' THEN
    UPDATE public.tenant_members
      SET status = 'active', display_name = v_name
      WHERE tenant_id = v_tenant_id AND user_id = v_uid;
    RETURN v_tenant_id;
  END IF;

  -- 他のジムに所属していないか（1アカウント1ジムの前提を崩さない）
  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.user_id = v_uid AND tm.tenant_id <> v_tenant_id AND tm.status = 'active'
  ) THEN
    RAISE EXCEPTION 'このアカウントは既に別のジムに参加しています'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 人数上限（tenants.max_trainers）は trg_enforce_tenant_member_limits が見る。
  -- SECURITY DEFINER でも BEFORE INSERT トリガーは走るので、ここでは何もしなくてよい。
  INSERT INTO public.tenant_members (tenant_id, user_id, role, display_name, status)
  VALUES (v_tenant_id, v_uid, 'trainer', v_name, 'active');

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_uid, 'trainer')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.profiles (user_id, display_name)
  VALUES (v_uid, v_name)
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  RETURN v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_tenant_as_staff_with_invite_code(text, text) TO authenticated;

-- ============================================================
-- 5) スタッフを外す
-- ============================================================
-- オーナーのみ。オーナー自身とオーナー行は消せない（ジムの管理者が居なくなるのを防ぐ）。
-- 顧客行も消せない（顧客の退会は別の導線。ここで消せると誤操作で顧客が消える）。
--
-- 担当予約が残っている場合は staff_user_id を NULL に戻す。外部キーを張らずに
-- NULL 化しているのは、予約自体は消さずに「担当なし」へ倒したいため
-- （消すとお客様の予約が黙って消える）。
CREATE OR REPLACE FUNCTION public.remove_staff_member(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant_id uuid;
  v_target_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT t.id INTO v_tenant_id
  FROM public.tenants t
  WHERE t.owner_user_id = v_uid
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'この操作はジムのオーナーのみ行えます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id = v_uid THEN
    RAISE EXCEPTION '自分自身は削除できません' USING ERRCODE = 'check_violation';
  END IF;

  SELECT tm.role INTO v_target_role
  FROM public.tenant_members tm
  WHERE tm.tenant_id = v_tenant_id AND tm.user_id = p_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION '対象のスタッフが見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_target_role <> 'trainer' THEN
    RAISE EXCEPTION 'スタッフ以外は削除できません' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.bookings
    SET staff_user_id = NULL
    WHERE tenant_id = v_tenant_id AND staff_user_id = p_user_id;

  DELETE FROM public.tenant_members
    WHERE tenant_id = v_tenant_id AND user_id = p_user_id AND role = 'trainer';
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_staff_member(uuid) TO authenticated;
