-- ============================================================================
-- 日ごとの「1日の上限人数まで、あと何件」（お客様の予約カレンダーの残り枠用）
--
-- 2026-10-06 宗本さん（残り枠の表示を見て）:
--   「僕のジムの場合、一日4枠までって制限掛けてるので、その設定は考慮しないと」
--
-- 残り枠（src/lib/dayRemainingSlots.ts）は「時間に何回入るか」しか見ていなかった。
-- 1日の上限（tenants.daily_booking_limit）がある店では、
--   残り = min(時間に入る回数, 上限 − その日の会員予約の件数)
-- にしないと、上限4の店で「残7」と出る。
--
-- ## 🔴 数え方は DB の1本（tenant_day_booking_count）をそのまま使う
--
-- 上限で閉めるガード（tenant_day_closed / GB007）と公開の受付終了一覧
-- （get_tenant_closed_days）が数えているのと**同じ関数**で数える。画面側で
-- 予約を数え直すと、体験（数えない）・当日キャンセル消化（数える）の扱いがズレて、
-- 「残1」と出ているのに断られる、が起きる。
--
-- ## 上限を外した日（booking_uncapped_days）は返さない
--
-- 返さない日＝上限なし＝時間だけで数える（画面側の既定）。手で閉めた日は
-- get_tenant_closed_days が「受付終了」として返すので、ここでは特別扱いしない。
--
-- ## 🔴 自分が所属しているジムだけ
--
-- 日ごとの予約件数はジムの混み具合そのもの。他のジムの会員には返さない。
-- 未ログイン（auth.uid() が NULL）は先に弾く（NULL との比較で素通りさせない）。
-- anon には EXECUTE を渡さない（会員の予約画面でしか使わない）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_tenant_daily_limit_left(
  p_tenant_id uuid,
  from_date date,
  to_date date
)
RETURNS TABLE(limit_date date, left_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer;
BEGIN
  IF p_tenant_id IS NULL OR from_date IS NULL OR to_date IS NULL
     OR to_date < from_date OR to_date > from_date + 92 THEN
    RETURN;
  END IF;

  IF v_uid IS NULL OR NOT public.is_tenant_member(p_tenant_id, v_uid) THEN
    RETURN;
  END IF;

  SELECT t.daily_booking_limit INTO v_limit
    FROM public.tenants t WHERE t.id = p_tenant_id;
  IF v_limit IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT d::date,
         GREATEST(0, v_limit - public.tenant_day_booking_count(p_tenant_id, d::date))::integer
    FROM generate_series(from_date, to_date, interval '1 day') AS d
   WHERE NOT EXISTS (
     SELECT 1 FROM public.booking_uncapped_days u
      WHERE u.tenant_id = p_tenant_id AND u.uncapped_date = d::date
   )
   ORDER BY 1;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_tenant_daily_limit_left(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_daily_limit_left(uuid, date, date) TO authenticated;
