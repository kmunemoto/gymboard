// GymBoard SaaS subscription plan definitions.
// Single source of truth for lookup_key -> plan mapping & limits.

export type GymboardPlan = 'free' | 'light' | 'standard' | 'premium';
export type GymboardPeriod = 'monthly' | 'yearly';

export interface PlanDefinition {
  plan: GymboardPlan;
  period: GymboardPeriod;
  max_customers: number | null; // null = unlimited
  max_trainers: number | null;  // null = unlimited
}

export const PLAN_LOOKUP_KEYS = [
  'gymboard_starter_monthly',
  'gymboard_starter_yearly',
  'gymboard_standard_monthly',
  'gymboard_standard_yearly',
  'gymboard_pro_monthly',
  'gymboard_pro_yearly',
] as const;

export type PlanLookupKey = typeof PLAN_LOOKUP_KEYS[number];

export const PLAN_MAP: Record<PlanLookupKey, PlanDefinition> = {
  gymboard_starter_monthly:  { plan: 'light',    period: 'monthly', max_customers: 20,   max_trainers: 3 },
  gymboard_starter_yearly:   { plan: 'light',    period: 'yearly',  max_customers: 20,   max_trainers: 3 },
  gymboard_standard_monthly: { plan: 'standard', period: 'monthly', max_customers: 30,   max_trainers: 5 },
  gymboard_standard_yearly:  { plan: 'standard', period: 'yearly',  max_customers: 30,   max_trainers: 5 },
  gymboard_pro_monthly:      { plan: 'premium',  period: 'monthly', max_customers: null, max_trainers: null },
  gymboard_pro_yearly:       { plan: 'premium',  period: 'yearly',  max_customers: null, max_trainers: null },
};

export const FREE_PLAN: PlanDefinition & { plan: 'free' } = {
  plan: 'free',
  period: 'monthly',
  max_customers: 5,
  max_trainers: 1,
};

export function isValidLookupKey(key: string): key is PlanLookupKey {
  return (PLAN_LOOKUP_KEYS as readonly string[]).includes(key);
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function isValidEnvironment(v: unknown): v is 'sandbox' | 'live' {
  return v === 'sandbox' || v === 'live';
}
