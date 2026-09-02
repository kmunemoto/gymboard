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

/**
 * 1枠の長さ（分）として選べる値。
 *
 * 🔴 ジム設定（`tenants.slot_duration_minutes`）とプラン別（`tenant_plans.slot_duration_minutes`）の
 * **両方がここを見る**。以前は TrainerGymSettings と TrainerPlanManager が
 * それぞれ `[30, 45, 60, 90, 120]` を持っていて、「片方に足して片方に足し忘れる」
 * 事故が起きる形だった（コメントで注意を促すだけで、仕掛けとしては防げていない）。
 *
 * 5分刻みにしてあるのは、実店舗が **50分**で回しているため（2026-09-02 宗本さん）。
 * 45分と60分しか無いと、実際の施術時間を設定できず、お客様側の
 * 「09:00〜10:00（60分）」表示も予約枠の長さも実態とずれる。
 *
 * 予約枠の**刻み**（`SLOT_STEP_MINUTES` = 15分）とは別物。1枠の長さを50分にしても
 * 開始時刻は15分刻みのまま（09:00〜09:50、09:15〜10:05 …）。
 */
export const SLOT_DURATION_OPTIONS: readonly number[] = [
  ...Array.from({ length: 22 }, (_, i) => 15 + i * 5), // 15〜120分（5分刻み）
  150,
  180,
];
