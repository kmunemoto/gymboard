import type { Tenant } from "@/hooks/useTenant";

// サブスク延滞/停止でアプリ利用が制限される状態か。
// サーバー側 is_tenant_subscription_blocked() と同じ条件をクライアントでも判定し、
// バナー等の表示に使う（実際のブロックはDBトリガーが強制する）。
//   - max_customers が null（無制限＝コンプ/運営。例: Salute）は対象外
//   - gymboard_plan='free'（無料枠）は対象外
//   - tenants.status が suspended/cancelled はブロック
//   - subscription_status が past_due/canceled/unpaid/incomplete_expired はブロック
const BLOCKED_SUB_STATUS = new Set(["past_due", "canceled", "unpaid", "incomplete_expired"]);

export function isTenantSubscriptionBlocked(tenant: Tenant | null | undefined): boolean {
  if (!tenant) return false;
  if (tenant.max_customers == null) return false;
  if (tenant.gymboard_plan === "free") return false;
  if (tenant.status === "suspended" || tenant.status === "cancelled") return true;
  if (tenant.subscription_status && BLOCKED_SUB_STATUS.has(tenant.subscription_status)) return true;
  return false;
}
