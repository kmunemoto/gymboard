-- 「その日はもう受け付けない」を1タップで（2026-09-01）
--
-- 実店舗の要望（宗本さん）: パーソナルジムは1日に見られる人数に限りがある。
-- 枠が空いていても「今日はもう受けない」と決めたい。いまは blocked_slots に
-- 枠を1つずつ入れて塞ぐしかなく、1日ぶん閉めるのに何度も操作が要る。
--
-- 2つ入れる:
--   (1) tenants.daily_booking_limit … 1日に受ける件数の上限。達したら自動で受付終了
--   (2) booking_closed_days         … その日を手で閉める。1行＝1日。作る/消すだけ
--
-- 🔴 店側の代理予約には効かせない（GB003/GB004/GB006 と同じ非対称）。
--    「今日はもう受けない」と決めたあとで常連さんを1人だけ足すのは店の裁量。
--    止めるのは **お客様の自己予約** と **公開の体験・ドロップイン予約** だけ。
--
-- 数えるのは bookings と trial_bookings の `status <> 'キャンセル済み'`。
-- check_booking_overlap（20260801000000）とまったく同じ条件にしてある。つまり
-- 「同日キャンセル済み」（消化扱い）は**数える**。予定表に枠として残り続けるものを
-- 空きとして数えると、受付終了にしたはずの日がひとりでに開いてしまう。
--
-- 体験・ドロップインも1件として数える。実際にその時間を専有して人を見るため
-- （容量トリガーが体験を1件として数えているのと同じ考え方）。

-- ── (1) 1日の上限件数 ────────────────────────────────────────────────
-- NULL = 上限なし（既定）。0 は禁止（全予約が入らなくなり原因が分かりにくい。
-- 「その日を閉める」は booking_closed_days の仕事で、上限0の代用にはさせない）。
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS daily_booking_limit integer;

COMMENT ON COLUMN public.tenants.daily_booking_limit IS
  '1日に受ける予約の上限件数（体験・ドロップイン含む）。NULL=上限なし。達した日はお客様側の受付を自動で終了する。店側の代理予約には効かない。';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_daily_booking_limit_positive;
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_daily_booking_limit_positive
  CHECK (daily_booking_limit IS NULL OR daily_booking_limit >= 1);

-- ── (2) 手で閉めた日 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_closed_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- JST の日付。timestamptz にしない: 「その日」という単位そのものを持たせたいので、
  -- 時刻とタイムゾーンを持つと 0:00 の解釈で日がずれる余地が生まれる。
  closed_date date NOT NULL,
  reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_closed_days_reason_len CHECK (reason IS NULL OR char_length(reason) <= 200)
);

-- 同じ日を二重に閉められないようにする。UI の「閉める/解除」は
-- この一意制約に乗って冪等になる（連打しても行は増えない）。
CREATE UNIQUE INDEX IF NOT EXISTS booking_closed_days_tenant_date
  ON public.booking_closed_days(tenant_id, closed_date);

COMMENT ON TABLE public.booking_closed_days IS
  'その日の受付を止める。1行＝1日（JST）。行があればお客様側の予約は入らない。店側の代理予約には効かない。';

ALTER TABLE public.booking_closed_days ENABLE ROW LEVEL SECURITY;

-- テナント境界。RESTRICTIVE なので、下の PERMISSIVE と AND で効く。
DROP POLICY IF EXISTS tenant_isolation ON public.booking_closed_days;
CREATE POLICY tenant_isolation ON public.booking_closed_days AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = public.get_my_tenant_id());

-- お客様も読む（自分のジムの「受付終了」を画面に出すため）。
DROP POLICY IF EXISTS booking_closed_days_select ON public.booking_closed_days;
CREATE POLICY booking_closed_days_select ON public.booking_closed_days
  FOR SELECT TO authenticated
  USING (true);

-- 作る・消すのはジム側だけ。
DROP POLICY IF EXISTS booking_closed_days_write ON public.booking_closed_days;
CREATE POLICY booking_closed_days_write ON public.booking_closed_days
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'trainer'::app_role) AND created_by = auth.uid());

DROP POLICY IF EXISTS booking_closed_days_delete ON public.booking_closed_days;
CREATE POLICY booking_closed_days_delete ON public.booking_closed_days
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'trainer'::app_role));

-- ── その日の予約件数 ────────────────────────────────────────────────
-- トリガーと公開RPCの両方が使う。SECURITY DEFINER なのは、公開の体験予約ページ
-- （anon）からも「その日はもう受け付けていない」を出せるようにするため。
-- 返すのは件数だけで、誰の予約かは一切返さない。
CREATE OR REPLACE FUNCTION public.tenant_day_booking_count(
  p_tenant_id uuid,
  p_date date,
  p_exclude_booking_id uuid DEFAULT NULL,
  p_exclude_trial_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT (
    (SELECT count(*) FROM public.bookings b
      WHERE b.tenant_id = p_tenant_id
        AND b.status <> 'キャンセル済み'
        AND (p_exclude_booking_id IS NULL OR b.id <> p_exclude_booking_id)
        AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date = p_date)
    +
    (SELECT count(*) FROM public.trial_bookings tb
      WHERE tb.tenant_id = p_tenant_id
        AND tb.status <> 'キャンセル済み'
        AND (p_exclude_trial_id IS NULL OR tb.id <> p_exclude_trial_id)
        AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date = p_date)
  )::integer;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_day_booking_count(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── その日はもう受け付けないか ───────────────────────────────────────
-- 「手で閉めた」と「上限に達した」を1か所にまとめる。画面もトリガーもここを見る。
CREATE OR REPLACE FUNCTION public.tenant_day_closed(
  p_tenant_id uuid,
  p_date date,
  p_exclude_booking_id uuid DEFAULT NULL,
  p_exclude_trial_id uuid DEFAULT NULL
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

  IF EXISTS (
    SELECT 1 FROM public.booking_closed_days d
     WHERE d.tenant_id = p_tenant_id AND d.closed_date = p_date
  ) THEN
    RETURN true;
  END IF;

  SELECT t.daily_booking_limit INTO v_limit
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_limit IS NULL THEN
    RETURN false;
  END IF;

  RETURN public.tenant_day_booking_count(p_tenant_id, p_date, p_exclude_booking_id, p_exclude_trial_id) >= v_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.tenant_day_closed(uuid, date, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 会員予約のガード（GB007）─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_booking_day_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_actor UUID;
  v_date  date;
BEGIN
  -- 外部同期で流し込む行は素通し（check_booking_overlap と同じ扱い）。
  -- あちらは to_jsonb(NEW) ->> 'source' で読んでいるが、ここは列を直接見る。
  -- bookings.source は 20260625100000 からある列で、無い環境は存在しない。
  IF NEW.source = 'salute_sync' THEN
    RETURN NEW;
  END IF;

  -- 🔴 お客様が自分で取る予約だけを見る（代理・サービスロールは店の裁量）。
  --    GB006 とまったく同じ条件。ここを緩めると、店が自分の予定表から
  --    1人足すこともできなくなる。
  v_actor := auth.uid();
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL OR NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  -- 日付が変わらない UPDATE は見ない。「キャンセル済み」からの復活は例外
  -- （キャンセル行を先に置いて後で復活させる抜け道を塞ぐ。GB003/GB006 と同じ）。
  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;

  v_date := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date;

  -- 自分自身は数えない（リスケで同じ行が移ってくるときに1件多く見えるのを防ぐ）
  IF public.tenant_day_closed(NEW.tenant_id, v_date, NEW.id, NULL) THEN
    RAISE EXCEPTION 'この日はご予約の受付を終了しました'
      USING ERRCODE = 'GB007';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guard_booking_day_closed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_booking_day_closed ON public.bookings;
CREATE TRIGGER trg_guard_booking_day_closed
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_booking_day_closed();

-- ── 体験・ドロップインのガード（GB007）───────────────────────────────
-- trial_bookings への INSERT は anon/authenticated から REVOKE 済みで、
-- 経路は Edge Function（trial-book / drop-in-book）の service_role だけ。
-- つまり **公開の予約フォームしか通らない**ので、会員予約のような
-- 「代理は素通し」の分岐は要らない（店側から体験を作る画面は存在しない）。
CREATE OR REPLACE FUNCTION public.guard_trial_booking_day_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_date date;
BEGIN
  IF NEW.tenant_id IS NULL OR NEW.status = 'キャンセル済み' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date
     AND NOT (OLD.status = 'キャンセル済み' AND NEW.status IS DISTINCT FROM 'キャンセル済み') THEN
    RETURN NEW;
  END IF;

  v_date := (NEW.booking_date AT TIME ZONE 'Asia/Tokyo')::date;

  IF public.tenant_day_closed(NEW.tenant_id, v_date, NULL, NEW.id) THEN
    RAISE EXCEPTION 'この日はご予約の受付を終了しました'
      USING ERRCODE = 'GB007';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guard_trial_booking_day_closed() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_trial_booking_day_closed ON public.trial_bookings;
CREATE TRIGGER trg_guard_trial_booking_day_closed
  BEFORE INSERT OR UPDATE ON public.trial_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_trial_booking_day_closed();

-- ── 受付を終了した日の一覧（公開RPC）─────────────────────────────────
-- 会員アプリ・公開の体験予約ページ・ドロップインページが、まとめて1回で読む。
-- 「手で閉めた日」と「上限に達した日」を**同じ答え**として返すので、
-- 画面側が2つの規則を持たなくてよい（規則はこのRPCと上のトリガーの1組だけ）。
--
-- 返すのは日付と、手動か自動かの区別だけ。誰の予約かは返さない。
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
  -- 過大な範囲は空を返す（公開エンドポイントの負荷対策。get_tenant_booked_slots と同じ93日）
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
  counted AS (
    SELECT (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date AS day, count(*) AS n
      FROM public.bookings b
     WHERE b.tenant_id = p_tenant_id
       AND b.status <> 'キャンセル済み'
       AND (b.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
     GROUP BY 1
    UNION ALL
    SELECT (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date AS day, count(*) AS n
      FROM public.trial_bookings tb
     WHERE tb.tenant_id = p_tenant_id
       AND tb.status <> 'キャンセル済み'
       AND (tb.booking_date AT TIME ZONE 'Asia/Tokyo')::date BETWEEN from_date AND to_date
     GROUP BY 1
  ),
  totals AS (
    SELECT c.day, sum(c.n) AS n FROM counted c GROUP BY c.day
  )
  SELECT d.day, (m.day IS NOT NULL), m.why
    FROM days d
    LEFT JOIN manual m ON m.day = d.day
    LEFT JOIN totals tt ON tt.day = d.day
   WHERE m.day IS NOT NULL
      OR (v_limit IS NOT NULL AND COALESCE(tt.n, 0) >= v_limit)
   ORDER BY d.day;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.get_tenant_closed_days(uuid, date, date) TO anon, authenticated;
