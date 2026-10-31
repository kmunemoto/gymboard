-- ============================================================================
-- 招待コードを知らない人が、お客様として好きなジムに入れないようにする（2026-10-31・穴12）
-- ============================================================================
-- 宗本さん「このアプリもセキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
--
-- ■ 何が起きていたか
-- tenant_members の INSERT ポリシー "Users can insert own membership" は
-- 「自分の行で role = 'customer'」なら**どのジムにでも**入れた（招待コードを見ていない）。
-- ジムの id さえ分かれば（体験予約ページの URL などに出ている）、ログインした人が API で
-- 自分をお客様として入れられる。入ると、お客様向けの情報（お知らせ・スタッフの名前・種目など）が読め、
-- 予約もできる。本番で演じて確かめた（ROLLBACK 済み）: 招待コード無しの参加 → 通った。
-- 穴11（20261031040000）を塞ぐ前は、ここから印を付けるとジムの全員のデータまで届いていた。
--
-- ■ 直し方（画面の手順は変えない。古いアプリもそのまま参加できる）
-- 参加の画面（JoinGym）は、どの版も「lookup_tenant_by_invite_code でコードを確かめる →
-- tenant_members に自分を upsert」の順（2026-05-17 から同じ）。そこで:
--   1. コードの確認が当たったら、ログインしている本人に「参加券」を出す
--      （tenant_join_tickets: 本人 × 招待コード × 時刻。24時間有効）
--   2. 画面からの直接の参加（authenticated が自分を customer で入れる）は、そのジムの**今の**
--      招待コードの参加券が無ければ断る（BEFORE INSERT トリガー）
-- 参加券を招待コードで持つので、ジムがコードを作り直すと、古いコードで取った券は使えなくなる。
-- ジムを閉じたときに消す表も増えない（tenant_id を持たない）。
-- 関数の中からの追加（ジムの開設・お客様の取り込み・スタッフの参加）と Edge Function（service_role）は対象外。
--
-- ⚠️ lookup は STABLE → VOLATILE（参加券を書くため）。PostgREST は STABLE の関数を読み取り専用の
--    トランザクションで呼ぶことがあるので、スキーマの読み直しが済むまでの間に呼ばれても検索自体は
--    落ちないよう、参加券の書き込みが読み取り専用で弾かれたときは握りつぶして結果だけ返す。
--
-- 見張り: src/test/customerJoinInviteCode.test.ts・security/check.sql の検査11
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 参加券（関数からだけ読み書きする。ポリシーを作らない＝誰も直接は読めない）
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_join_tickets (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, invite_code)
);

COMMENT ON TABLE public.tenant_join_tickets IS
  'お客様としてジムに参加するための参加券。招待コードを確かめた本人に24時間だけ出す。関数からだけ読み書きする（ポリシーを作らない）';

ALTER TABLE public.tenant_join_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_join_tickets FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. 招待コードの確認（JoinGym が呼ぶ）… 当たったら、ログインしている本人に参加券を出す
--    戻り値・引数・権限は今まで通り（古いアプリも同じ呼び方）
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_tenant_by_invite_code(p_code text)
RETURNS TABLE(id uuid, gym_name text, address text, logo_url text, primary_color text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code text := lower(replace(p_code, '-', ''));
  v_hit  public.tenants%ROWTYPE;
BEGIN
  SELECT t.* INTO v_hit
    FROM public.tenants t
   WHERE t.invite_code = v_code
     AND t.status IN ('active', 'trial')
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    BEGIN
      INSERT INTO public.tenant_join_tickets (user_id, invite_code, created_at)
      VALUES (auth.uid(), v_code, now())
      ON CONFLICT (user_id, invite_code) DO UPDATE SET created_at = now();
      DELETE FROM public.tenant_join_tickets k WHERE k.created_at < now() - interval '7 days';
    EXCEPTION WHEN read_only_sql_transaction THEN
      NULL;
    END;
  END IF;

  id := v_hit.id;
  gym_name := v_hit.gym_name;
  address := v_hit.address;
  logo_url := v_hit.logo_url;
  primary_color := v_hit.primary_color;
  RETURN NEXT;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. 参加の門番
-- ----------------------------------------------------------------------------

-- そのジムの今の招待コードで、24時間以内に出た参加券を本人が持っているか
CREATE OR REPLACE FUNCTION public.has_tenant_join_ticket(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.tenants t
      JOIN public.tenant_join_tickets k ON k.invite_code = t.invite_code
     WHERE t.id = p_tenant_id
       AND t.status IN ('active', 'trial')
       AND k.user_id = auth.uid()
       AND k.created_at > now() - interval '24 hours'
  );
$$;

-- トリガーは呼んだ人の権限で動くので、authenticated に EXECUTE が要る
REVOKE ALL ON FUNCTION public.has_tenant_join_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_tenant_join_ticket(uuid) TO authenticated, service_role;

-- 画面からの直接の参加（ログインした人が customer の行を入れる）だけを見る。
-- 🔴 SECURITY INVOKER のままにすること。current_user で「画面から（authenticated）」と
--    「関数の中から（所有者）・Edge Function（service_role）」を見分けている。DEFINER にすると常に所有者になり、
--    門番が素通りになる。
CREATE OR REPLACE FUNCTION public.guard_customer_self_join()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NEW.role = 'customer'
     AND NOT public.has_tenant_join_ticket(NEW.tenant_id) THEN
    RAISE EXCEPTION '招待コードを確認してから参加してください' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_customer_self_join ON public.tenant_members;
CREATE TRIGGER trg_guard_customer_self_join
  BEFORE INSERT ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_self_join();
