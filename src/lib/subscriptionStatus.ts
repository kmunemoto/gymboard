import type { Tenant } from "@/hooks/useTenant";

// サブスク延滞/停止でアプリ利用が制限される状態か。
// サーバー側 is_tenant_subscription_blocked() と同じ条件をクライアントでも判定し、
// バナー等の表示に使う（実際のブロックはDBトリガーが強制する）。
//   - max_customers が null（無制限＝コンプ/運営。例: Salute）は対象外
//   - gymboard_plan='free'（無料枠）は対象外
//   - tenants.status が suspended/cancelled はブロック
//   - subscription_status が past_due/canceled/unpaid/incomplete_expired はブロック
//   - Stripeサブスク未設定(subscription_status=null)の有料プランで、
//     トライアル期限を1日以上過ぎている場合もブロック
const BLOCKED_SUB_STATUS = new Set(["past_due", "canceled", "unpaid", "incomplete_expired"]);
const TRIAL_GRACE_MS = 24 * 60 * 60 * 1000;

export function isTenantSubscriptionBlocked(tenant: Tenant | null | undefined): boolean {
  if (!tenant) return false;
  if (tenant.max_customers == null) return false;
  if (tenant.gymboard_plan === "free") return false;
  if (tenant.status === "suspended" || tenant.status === "cancelled") return true;
  if (tenant.subscription_status && BLOCKED_SUB_STATUS.has(tenant.subscription_status)) return true;
  // Stripeサブスク未設定でトライアル期限を1日以上過ぎている → 未課金の期限切れ
  if (!tenant.subscription_status && tenant.trial_ends_at) {
    const ended = Date.parse(tenant.trial_ends_at);
    if (!Number.isNaN(ended) && ended < Date.now() - TRIAL_GRACE_MS) return true;
  }
  return false;
}
