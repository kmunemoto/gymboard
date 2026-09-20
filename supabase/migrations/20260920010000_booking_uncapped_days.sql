-- ============================================================================
-- その日だけ「1日の上限人数」を適用しない（2026-09-20 宗本さんの要望）
--
--   > 今入れられる予約を1日4人までにしてて、4枠予約が入ったら受付をやめる様に
--   > しているのですが、ベースはそれで特定の日はそのルールを適応しない様にしたい。
--   > 例えば日にちを2回目のタップを押したらルールを外せるとかの仕様を追加してほしい。
--
-- 決定（2026-09-20）:
--   操作   … 予定表のオレンジ「上限に達しました」をタップ → その日だけ上限なし。
--            もう一度タップで上限が戻る
--   外した日 … **無制限**（人数の指定はしない）
--
-- ## 既存の2つとの関係
--
--   booking_closed_days（手で止めた日）… その日を閉める。**こちらのほうが強い**
--   tenants.daily_booking_limit        … 全日に効く基本のルール
--   booking_uncapped_days（これ）      … **その日だけ上限を見ない**
--
-- 🔴 **手で止めた日のほうが強い。** 「上限なし」にした日でも、店が手で閉めたら閉まる。
--    逆にすると、「今日はもう受けない」と決めた日が上限なしの指定で勝手に開いてしまう。
--    `tenant_day_closed` は手動の判定を**先に**済ませてから上限なしを見る。
--
-- ## 何を外して、何を外さないか
--
--   外す     … 1日の人数の上限（daily_booking_limit）だけ
--   外さない … 営業時間・定休日・予約の締切・同時受入数・時間ブロック・
--              担当のシフト・プランの回数上限・受付しない時間帯
--
-- つまり「1日4人まで」を無視するだけで、**物理的に入らない枠は入らない**。
--
-- ## 数え方は変えていない
--
-- `tenant_day_booking_count` は触らない。上限なしの日でも件数は今までどおり数える
-- （予定表の「n/4人」の表示に使う）。変えるのは**その件数で閉めるかどうか**だけ。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_uncapped_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- JST の日付。booking_closed_days と同じ理由で date にする
  -- （timestamptz にすると 0:00 の解釈で日がずれる余地が生まれる）。
  uncapped_date date NOT NULL,
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_uncapped_days_reason_len CHECK (reason IS NULL OR char_length(reason) <= 200)
);

-- 同じ日を二重に登録できないようにする。UI の「外す/戻す」はこの一意制約に乗って
-- 冪等になる（連打しても行は増えない）。booking_closed_days と同じ作り。
CREATE UNIQUE INDEX IF NOT EXISTS booking_uncapped_days_tenant_date
  ON public.booking_uncapped_days(tenant_id, uncapped_date);

COMMENT ON TABLE public.booking_uncapped_days IS
  'その日だけ「1日の上限人数」を適用しない。1行＝1日（JST）。'
  '行があれば daily_booking_limit を無視して受け付ける（無制限）。'
  '🔴 手で止めた日（booking_closed_days）のほうが強く、そちらがあれば閉まったまま。'
  '営業時間・締切・同時受入数・時間ブロック等は今までどおり効く。';

ALTER TABLE public.booking_uncapped_days ENABLE ROW LEVEL SECURITY;

-- テナント境界。RESTRICTIVE なので、下の PERMISSIVE と AND で効く。
DROP POLICY IF EXISTS tenant_isolation ON public.booking_uncapped_days;
CREATE POLICY tenant_isolation ON public.booking_uncapped_days AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- 🔴 読むのはジム側だけ。お客様には見せない。
--    お客様の画面に必要なのは「その日が受付終了か」だけで、それは
--    get_tenant_closed_days（SECURITY DEFINER）が答える。ここを開けても
--    お客様に新しく分かることは無く、店の運用が見えるだけ。
DROP POLICY IF EXISTS booking_uncapped_days_select ON public.booking_uncapped_days;
CREATE POLICY booking_uncapped_days_select ON public.booking_uncapped_days
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

DROP POLICY IF EXISTS booking_uncapped_days_write ON public.booking_uncapped_days;
CREATE POLICY booking_uncapped_days_write ON public.booking_uncapped_days
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role) AND created_by = auth.uid());

DROP POLICY IF EXISTS booking_uncapped_days_delete ON public.booking_uncapped_days;
CREATE POLICY booking_uncapped_days_delete ON public.booking_uncapped_days
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

-- ── その日が受付終了か（本番の現行定義に上限なしの分岐だけを足す）──────────
CREATE OR REPLACE FUNCTION public.tenant_day_closed(
  p_tenant_id uuid,
  p_date date,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF p_tenant_id IS NULL OR p_date IS NULL THEN
    RETURN false;
  END IF;

  -- 🔴 手で止めた日が最優先。上限なしの指定より先に判定する。
  --    順番を入れ替えると「今日はもう受けない」と決めた日が勝手に開く。
  IF EXISTS (
    SELECT 1 FROM public.booking_closed_days d
     WHERE d.tenant_id = p_tenant_id AND d.closed_date = p_date
  ) THEN
    RETURN true;
  END IF;

  -- 🔴 この日だけ上限なし（2026-09-20）。件数を数えずにここで抜ける。
  IF EXISTS (
    SELECT 1 FROM public.booking_uncapped_days u
     WHERE u.tenant_id = p_tenant_id AND u.uncapped_date = p_date
  ) THEN
    RETURN false;
  END IF;

  SELECT t.daily_booking_limit INTO v_limit
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_limit IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.tenant_day_booking_count(p_tenant_id, p_date, p_exclude_booking_id) >= v_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_day_closed(uuid, date, uuid) FROM PUBLIC, anon, authenticated;

-- ── 受付を終了した日の一覧（公開RPC）────────────────────────────────────
-- 本番の現行定義に「上限なしの日は、上限では閉めない」だけを足す。
-- ⚠️ 手で閉めた日（manual）はそのまま返す。上限なしの指定は上限にしか効かない。
CREATE OR REPLACE FUNCTION public.get_tenant_closed_days(
  p_tenant_id uuid,
  from_date date,
  to_date date
)
RETURNS TABLE(closed_date date, manual boolean, reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_limit integer;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  SELECT t.daily_booking_limit INTO v_limit
    FROM public.tenants t WHERE t.id = p_tenant_id;

  RETURN QUERY
  WITH days AS (
    SELECT d::date AS day FROM generate_series(from_date, to_date, interval '1 day') AS d
  ),
  manual AS (
    SELECT c.closed_date AS day, c.reason AS why
      FROM public.booking_closed_days c
     WHERE c.tenant_id = p_tenant_id
       AND c.closed_date BETWEEN from_date AND to_date
  ),
  -- 🔴 この日だけ上限なし。下の判定で「上限で閉める」側からだけ外す。
  uncapped AS (
    SELECT u.uncapped_date AS day
      FROM public.booking_uncapped_days u
     WHERE u.tenant_id = p_tenant_id
       AND u.uncapped_date BETWEEN from_date AND to_date
  ),
  totals AS (
    SELECT (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date AS day, count(*) AS n
      FROM public.bookings b
     WHERE b.tenant_id = p_tenant_id
       AND b.status <> 'キャンセル済み'
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
     GROUP BY 1
  )
  SELECT d.day, (m.day IS NOT NULL), m.why
    FROM days d
    LEFT JOIN manual m ON m.day = d.day
    LEFT JOIN uncapped u ON u.day = d.day
    LEFT JOIN totals tt ON tt.day = d.day
   WHERE m.day IS NOT NULL
      OR (v_limit IS NOT NULL AND COALESCE(tt.n, 0) >= v_limit AND u.day IS NULL)
   ORDER BY d.day;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_tenant_closed_days(uuid, date, date) TO anon, authenticated;
