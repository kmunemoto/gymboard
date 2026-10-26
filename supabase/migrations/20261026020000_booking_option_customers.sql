-- ============================================================================
-- 予約のオプションを、店が指定したお客様だけに出す（2026-10-26）
--
-- 宗本さん「オプションをお店が指定した特定のお客様だけがアプリから予約の際に選べる様に
-- できる機能を追加して」。
--
-- 決めたこと（既定の判断）:
--   - オプションごとに「指定したお客様だけ」を選べる（booking_options.restricted）
--   - 指定するお客様は booking_option_customers に1行ずつ持つ
--   - 指定されていないお客様には**出さない**（選択肢に現れない）
--   - 店の代理予約・あとから足す（GB008 の画面）は今まで通り、どのお客様にも付けられる（店の裁量）
--   - すでに入っている予約はそのまま。日時の変更ではオプションを引き継ぐ
--
-- ## 🔴 出し分けは表の読み取り権限（RLS）でやる
--
-- お客様の予約画面は booking_options を直接読んでいる。権限で絞れば、
-- **古いアプリのお客様にも限定オプションは見えない**（画面側の対応を待たない）。
--
-- ## 🔴 それでも DB で断る（GB010）
--
-- 画面に出さなくても、API を直接叩けば控え（bookings.booking_options）に好きな id を書ける。
-- お客様の自己予約で、指定されていない限定オプションが付いていたら断る。
-- 例外は日時の変更（created_via = 'reschedule'）: 元の予約に付いていたものを引き継ぐ。
-- 変更は「元の予約を消してから入れ直す」ので、元の予約を探して確かめることができない。
--
-- ⚠️ 特定のジムの値はここには書かない（リポジトリは public）。
-- ============================================================================

-- ── (1) 限定かどうか ──────────────────────────────────────────────────
ALTER TABLE public.booking_options
  ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.booking_options.restricted IS
  'true のとき、booking_option_customers に入っているお客様にだけ予約画面で出す（店の代理予約では誰にでも付けられる）。false=全員に出す（今まで通り）';

-- ── (2) 選べるお客様 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_option_customers (
  option_id  uuid NOT NULL REFERENCES public.booking_options(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);

COMMENT ON TABLE public.booking_option_customers IS
  '限定のオプション（booking_options.restricted）を選べるお客様。店のスタッフだけが読み書きする';

CREATE INDEX IF NOT EXISTS booking_option_customers_user
  ON public.booking_option_customers(user_id);

ALTER TABLE public.booking_option_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_option_customers FROM anon;
GRANT SELECT, INSERT, DELETE ON public.booking_option_customers TO authenticated;

DROP POLICY IF EXISTS tenant_isolation ON public.booking_option_customers;
CREATE POLICY tenant_isolation ON public.booking_option_customers AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

DROP POLICY IF EXISTS booking_option_customers_select ON public.booking_option_customers;
CREATE POLICY booking_option_customers_select ON public.booking_option_customers
  FOR SELECT TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- 入れるとき: そのジムのスタッフで、オプションも同じジムのもの、相手もそのジムの在籍者
DROP POLICY IF EXISTS booking_option_customers_insert ON public.booking_option_customers;
CREATE POLICY booking_option_customers_insert ON public.booking_option_customers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
    AND EXISTS (
      SELECT 1 FROM public.booking_options o
       WHERE o.id = booking_option_customers.option_id
         AND o.tenant_id = booking_option_customers.tenant_id
    )
    AND public.is_tenant_member(tenant_id, user_id)
  );

DROP POLICY IF EXISTS booking_option_customers_delete ON public.booking_option_customers;
CREATE POLICY booking_option_customers_delete ON public.booking_option_customers
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']));

-- ── (3) そのお客様が限定オプションを選べるか ──────────────────────────────
-- 読み取り権限の中から使う。お客様は booking_option_customers を読めないので SECURITY DEFINER。
CREATE OR REPLACE FUNCTION public.booking_option_allowed(p_option_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.booking_option_customers c
     WHERE c.option_id = p_option_id AND c.user_id = p_user_id
  );
$fn$;
REVOKE ALL ON FUNCTION public.booking_option_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_option_allowed(uuid, uuid) TO authenticated;

-- ── (4) 読み取り権限: 限定のものは、店のスタッフと指定されたお客様にだけ見せる ──────────
DROP POLICY IF EXISTS booking_options_select ON public.booking_options;
CREATE POLICY booking_options_select ON public.booking_options
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_member(tenant_id, auth.uid())
    AND (
      NOT restricted
      OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer'])
      OR public.booking_option_allowed(id, auth.uid())
    )
  );

-- ── (5) 公開ページ用（未ログイン）: 限定のものは出さない ─────────────────────
CREATE OR REPLACE FUNCTION public.get_tenant_booking_options(p_tenant_id uuid)
RETURNS TABLE(id uuid, name text, duration_minutes integer, price_yen integer, description text, sort_order integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT o.id, o.name, o.duration_minutes, o.price_yen, o.description, o.sort_order
    FROM public.booking_options o
    JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.tenant_id = p_tenant_id
     AND o.enabled
     AND NOT o.restricted
     AND t.status IN ('active', 'trial')
   ORDER BY o.sort_order, o.created_at;
$fn$;

-- ── (6) お客様の自己予約: 指定されていない限定オプションが付いていたら断る（GB010） ────────
CREATE OR REPLACE FUNCTION public.guard_booking_restricted_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_opts  jsonb := to_jsonb(NEW) -> 'booking_options';
BEGIN
  IF (to_jsonb(NEW) ->> 'source') = 'salute_sync' THEN
    RETURN NEW;
  END IF;
  -- 店の代理予約・サービスロールは通す（店の裁量）
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;
  -- 日時の変更は、元の予約に付いていたオプションを引き継ぐ
  IF (to_jsonb(NEW) ->> 'created_via') = 'reschedule' THEN
    RETURN NEW;
  END IF;
  IF v_opts IS NULL OR jsonb_typeof(v_opts) <> 'array' OR jsonb_array_length(v_opts) = 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(v_opts) AS e
      JOIN public.booking_options o ON o.id::text = (e ->> 'id')
     WHERE o.tenant_id = NEW.tenant_id
       AND o.restricted
       AND NOT EXISTS (
         SELECT 1 FROM public.booking_option_customers c
          WHERE c.option_id = o.id AND c.user_id = NEW.user_id
       )
  ) THEN
    RAISE EXCEPTION 'このオプションは選べません' USING ERRCODE = 'GB010';
  END IF;

  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.guard_booking_restricted_options() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_restricted_options ON public.bookings;
CREATE TRIGGER trg_guard_booking_restricted_options
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_restricted_options();
