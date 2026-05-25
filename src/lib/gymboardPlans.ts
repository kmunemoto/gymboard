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
    monthlyPrice: 4980,
    yearlyPrice: 49800,
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

const STRIPE_ENV_STORAGE_KEY = "gymboard_stripe_env_override";

/**
 * Determine Stripe environment.
 * Priority:
 *   1. ?stripe_env=sandbox|live URL query (also persisted to localStorage)
 *   2. localStorage override (set via the query param above)
 *   3. Hostname: gymboard.lovable.app -> live, everything else -> sandbox
 *
 * To force sandbox on the production domain for testing, visit:
 *   https://gymboard.lovable.app/?stripe_env=sandbox
 * To clear the override:
 *   https://gymboard.lovable.app/?stripe_env=auto
 */
export function detectStripeEnvironment(hostname: string): "sandbox" | "live" {
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("stripe_env");
      if (q === "sandbox" || q === "live") {
        window.localStorage.setItem(STRIPE_ENV_STORAGE_KEY, q);
        return q;
      }
      if (q === "auto" || q === "clear") {
        window.localStorage.removeItem(STRIPE_ENV_STORAGE_KEY);
      }
      const stored = window.localStorage.getItem(STRIPE_ENV_STORAGE_KEY);
      if (stored === "sandbox" || stored === "live") return stored;
    } catch { /* ignore storage errors */ }
  }
  if (hostname === "gymboard.lovable.app") return "live";
  return "sandbox";
}

export function formatLimit(n: number | null): string {
  return n === null ? "無制限" : `${n}名`;
}
