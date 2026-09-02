-- ============================================================================
-- 予約のオプション（booking_options）
-- ============================================================================
--
-- 実店舗の要望（2026-09-02 宗本さん）:
--   「トレーニングのあとに 30分 3,000円 のストレッチを付けられるようにしたい。
--     予約するときにお客様が選べるようにしたい。」
--
-- ## 追加の時間は「同じ1回のセッション」として扱う
--
-- 🔴 トレーニングとストレッチの**間に準備時間（`tenants.booking_buffer_minutes`）は
--    入れない**。宗本さんの明言:「一つのセッションの時間として扱います」。
--    つまり占有はこうなる:
--
--      60分（枠） + 30分（オプション） + 15分（次のお客様までの間） = 105分
--
--    「60分 + 15分 + 30分 + 15分」ではない。間を2回取ると、実際には空いている
--    15分が予約表から消える。
--
--    ⚠️ この占有時間の計算（`check_booking_overlap`）は**この版では変えていない**。
--    ここで作るのは「店がオプションを定義できる」ところまで。お客様側の選択と
--    占有への加算は次の版で入れる（`bookings.option_minutes` を足して、トリガーの
--    **3箇所**——これから入れる予約 / 既存の bookings / 既存の trial_bookings——を
--    同時に直す。片方だけ直すと左右非対称の判定になる）。
--
-- ## なぜ tenant_plans と別の表にするのか
--
-- `tenant_plans` は「どのコースを契約しているか」で、回数・料金・消化の対象。
-- オプションは**1回の予約に後付けする追加**で、契約とは別物。混ぜると
-- 「プラン一覧」に 30分ストレッチが並び、回数の消化や請求の対象に見えてしまう。
--
-- ## 料金は「表示のための数字」
--
-- ジムボードは決済をアプリ内で行わない（Stripe はサブスク課金のみ）。ここの
-- `price_yen` は**お客様に見せる金額**で、支払いは店頭。だから 0 は「無料」ではなく
-- **「料金を表示しない」**の意味にする（掲示したくない店・回数券に含む店がある）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_options (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- お客様に見える名前。「ストレッチ」「パーソナル整体」など
  name          TEXT NOT NULL,
  -- 追加でかかる時間（分）。0 は「時間は増えないオプション」（プロテイン等）
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  -- 表示用の金額（円）。0 は「料金を表示しない」
  price_yen     INTEGER NOT NULL DEFAULT 0,
  -- 補足（「トレーニング後に続けて行います」など）。空でよい
  description   TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 空白だけの名前を許すと、予約画面に押せるだけの空のボタンが出る
  CONSTRAINT booking_options_name_check
    CHECK (btrim(name) <> '' AND char_length(name) <= 40),
  -- 上限は 180分。これを超える「オプション」は、もうプランとして持つべきもの。
  CONSTRAINT booking_options_duration_check
    CHECK (duration_minutes >= 0 AND duration_minutes <= 180),
  -- 桁の打ち間違い（3000 のつもりで 300000）を止める。日本円の整数で持つ。
  CONSTRAINT booking_options_price_check
    CHECK (price_yen >= 0 AND price_yen <= 1000000)
);

COMMENT ON TABLE public.booking_options IS
  '予約に後付けするオプション（例: トレーニング後の30分ストレッチ）。'
  'duration_minutes は同じ1回のセッションの一部として占有に足す（間の準備時間は入れない）。'
  'price_yen は表示用で決済はしない。0 は「料金を表示しない」。';

CREATE INDEX IF NOT EXISTS idx_booking_options_tenant
  ON public.booking_options (tenant_id);

-- ----------------------------------------------------------------------------
-- RLS（booking_capacity_windows と同じ形）
-- ----------------------------------------------------------------------------
ALTER TABLE public.booking_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.booking_options;
CREATE POLICY tenant_isolation ON public.booking_options AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 読みは同じジムの人全員。お客様の予約画面が「付けられるオプション」を出すのに要る。
-- 中身は店のメニューで、誰の情報も含まない。
DROP POLICY IF EXISTS booking_options_select ON public.booking_options;
CREATE POLICY booking_options_select ON public.booking_options
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id, auth.uid()));

DROP POLICY IF EXISTS booking_options_write ON public.booking_options;
CREATE POLICY booking_options_write ON public.booking_options
  FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_options_update ON public.booking_options;
CREATE POLICY booking_options_update ON public.booking_options
  FOR UPDATE TO authenticated
  USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
  WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

DROP POLICY IF EXISTS booking_options_delete ON public.booking_options;
CREATE POLICY booking_options_delete ON public.booking_options
  FOR DELETE TO authenticated
  USING (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));

-- 表そのものは anon に開けない。公開ページには下の RPC の戻り列だけを見せる
-- （2026-08-06 の方針）。
REVOKE ALL ON public.booking_options FROM anon;

CREATE OR REPLACE FUNCTION public.touch_booking_options()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_touch_booking_options ON public.booking_options;
CREATE TRIGGER trg_touch_booking_options
  BEFORE UPDATE ON public.booking_options
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_booking_options();

-- ----------------------------------------------------------------------------
-- 公開ページ用の RPC（体験・ドロップインの予約ページはログイン前）
-- ----------------------------------------------------------------------------
-- get_tenant_capacity_windows と同じ形。有効な行だけ、並び順つきで返す。
CREATE OR REPLACE FUNCTION public.get_tenant_booking_options(p_tenant_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  duration_minutes INTEGER,
  price_yen INTEGER,
  description TEXT,
  sort_order INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT o.id, o.name, o.duration_minutes, o.price_yen, o.description, o.sort_order
    FROM public.booking_options o
    JOIN public.tenants t ON t.id = o.tenant_id
   WHERE o.tenant_id = p_tenant_id
     AND o.enabled
     -- 休止・解約した店の設定は公開しない（get_tenant_public と同じ条件）
     AND t.status IN ('active', 'trial')
   ORDER BY o.sort_order, o.created_at;
$function$;

GRANT EXECUTE ON FUNCTION public.get_tenant_booking_options(UUID) TO anon, authenticated;
