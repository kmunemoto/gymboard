// GymBoard SaaS subscription plan definitions (client-side).
// Mirrors supabase/functions/_shared/gymboard-plans.ts.

export type GymboardPlan = "free" | "light" | "standard" | "premium";
export type GymboardPeriod = "monthly" | "yearly";

export interface PlanCardDef {
  plan: GymboardPlan;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxCustomers: number | null; // null = unlimited
  maxTrainers: number | null;
  monthlyLookupKey: string | null;
  yearlyLookupKey: string | null;
  description: string;
}

export const PLAN_CARDS: PlanCardDef[] = [
  {
    plan: "free",
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    maxCustomers: 5,
    maxTrainers: 1,
    monthlyLookupKey: null,
    yearlyLookupKey: null,
    description: "個人で試しに使い始めるためのプラン",
  },
  {
    plan: "light",
    name: "Starter",
    monthlyPrice: 3980,
    yearlyPrice: 39800,
    maxCustomers: 20,
    maxTrainers: 3,
    monthlyLookupKey: "gymboard_starter_monthly",
    yearlyLookupKey: "gymboard_starter_yearly",
    description: "小規模ジム向け",
  },
  {
    plan: "standard",
    name: "Standard",
    monthlyPrice: 6980,
    yearlyPrice: 69800,
    maxCustomers: 50,
    maxTrainers: 5,
    monthlyLookupKey: "gymboard_standard_monthly",
    yearlyLookupKey: "gymboard_standard_yearly",
    description: "中規模ジム向け",
  },
  {
    plan: "premium",
    name: "Pro",
    monthlyPrice: 9800,
    yearlyPrice: 98000,
    maxCustomers: null,
    maxTrainers: null,
    monthlyLookupKey: "gymboard_pro_monthly",
    yearlyLookupKey: "gymboard_pro_yearly",
    description: "大規模ジム・無制限プラン",
  },
];

export function lookupKeyFor(plan: GymboardPlan, period: GymboardPeriod): string | null {
  const card = PLAN_CARDS.find((p) => p.plan === plan);
  if (!card) return null;
  return period === "yearly" ? card.yearlyLookupKey : card.monthlyLookupKey;
}

export function getPlanCard(plan: GymboardPlan): PlanCardDef | undefined {
  return PLAN_CARDS.find((p) => p.plan === plan);
}

/**
 * Determine Stripe environment from current hostname.
 * Production (gymboard.lovable.app) -> live, everything else -> sandbox.
 */
export function detectStripeEnvironment(hostname: string): "sandbox" | "live" {
  if (hostname === "gymboard.lovable.app") return "live";
  return "sandbox";
}

export function formatLimit(n: number | null): string {
  return n === null ? "無制限" : `${n}名`;
}
