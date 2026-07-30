/**
 * プラン名 + tenant_plans 定義から「予約1件あたりの占有時間（分）」を解決する。
 *
 * ジムには1つの既定値（tenants.slot_duration_minutes）があるが、プランごとに
 * 短時間メニュー（例:「月4回(30分)」）を用意したい場合はプラン側で上書きできる。
 * 未設定（null）のプランはジムの既定値をそのまま継承する
 * （resolveCycleMonths / resolveGraceDays と同じ「null=継承」の作法）。
 *
 * 予約の重複判定・埋まり枠取得は DB 側（check_booking_overlap トリガー /
 * get_tenant_booked_slots RPC）が同じロジックで権威的に計算する
 * （supabase/migrations/20260730120000_tenant_plans_slot_duration.sql）。
 * ここはクライアント側の表示・事前チェック用の同一ロジック。
 */
export const resolvePlanSlotMinutes = (
  planName: string | null | undefined,
  tenantPlans: ReadonlyArray<{ plan_name: string; slot_duration_minutes?: number | null }> | null | undefined,
  tenantDefaultMinutes: number,
): number => {
  if (!planName || !tenantPlans) return tenantDefaultMinutes;
  const p = tenantPlans.find((tp) => tp.plan_name === planName);
  return p?.slot_duration_minutes ?? tenantDefaultMinutes;
};
