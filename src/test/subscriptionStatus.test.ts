import { describe, it, expect } from "vitest";
import { computeSubscriptionBlocked, isTenantSubscriptionBlocked } from "@/lib/subscriptionStatus";
import { BILLING_ENABLED } from "@/lib/featureFlags";
import type { Tenant } from "@/hooks/useTenant";

// 関連フィールドだけを指定してTenantを組み立てる（テスト用）。
const mk = (o: Partial<Tenant>): Tenant =>
  ({
    max_customers: 5,
    gymboard_plan: "standard",
    status: "active",
    subscription_status: "active",
    trial_ends_at: null,
    ...o,
  } as unknown as Tenant);

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe("computeSubscriptionBlocked（延滞判定ロジック）", () => {
  it("null テナントはブロックしない", () => {
    expect(computeSubscriptionBlocked(null)).toBe(false);
  });

  it("無制限(max_customers=null, 例:Salute)は延滞でもブロックしない", () => {
    expect(computeSubscriptionBlocked(mk({ max_customers: null, subscription_status: "past_due" }))).toBe(false);
  });

  it("無料プランは延滞でもブロックしない", () => {
    expect(computeSubscriptionBlocked(mk({ gymboard_plan: "free", subscription_status: "past_due" }))).toBe(false);
  });

  it("status が suspended / cancelled はブロック", () => {
    expect(computeSubscriptionBlocked(mk({ status: "suspended" }))).toBe(true);
    expect(computeSubscriptionBlocked(mk({ status: "cancelled" }))).toBe(true);
  });

  it("支払い延滞ステータスはブロック", () => {
    for (const s of ["past_due", "canceled", "unpaid", "incomplete_expired"]) {
      expect(computeSubscriptionBlocked(mk({ subscription_status: s }))).toBe(true);
    }
  });

  it("active / trialing はブロックしない", () => {
    expect(computeSubscriptionBlocked(mk({ subscription_status: "active" }))).toBe(false);
    expect(computeSubscriptionBlocked(mk({ subscription_status: "trialing" }))).toBe(false);
  });

  it("サブスク未設定＋トライアル期限切れ(1日超)はブロック", () => {
    expect(
      computeSubscriptionBlocked(mk({ subscription_status: null, trial_ends_at: daysFromNow(-3) })),
    ).toBe(true);
  });

  it("サブスク未設定でもトライアルが未来ならブロックしない", () => {
    expect(
      computeSubscriptionBlocked(mk({ subscription_status: null, trial_ends_at: daysFromNow(3) })),
    ).toBe(false);
  });

  it("トライアル期限切れでも猶予1日以内はブロックしない", () => {
    const halfDayAgo = new Date(Date.now() - 12 * 3_600_000).toISOString();
    expect(
      computeSubscriptionBlocked(mk({ subscription_status: null, trial_ends_at: halfDayAgo })),
    ).toBe(false);
  });

  it("サブスク未設定＋トライアル日時無しはブロックしない", () => {
    expect(computeSubscriptionBlocked(mk({ subscription_status: null, trial_ends_at: null }))).toBe(false);
  });
});

describe("isTenantSubscriptionBlocked（課金フラグ BILLING_ENABLED を尊重）", () => {
  const blocked = mk({ subscription_status: "past_due" });
  it("課金無効化中は延滞でもブロックしない / 有効化中は素の判定に従う", () => {
    if (!BILLING_ENABLED) {
      expect(isTenantSubscriptionBlocked(blocked)).toBe(false);
    } else {
      expect(isTenantSubscriptionBlocked(blocked)).toBe(computeSubscriptionBlocked(blocked));
    }
  });
});
