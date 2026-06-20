import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import i18n from "@/lib/i18n";

export interface TenantLimitStatus {
  customer_count: number;
  trainer_count: number;
  max_customers: number | null;
  max_trainers: number | null;
  customer_over: boolean;
  trainer_over: boolean;
  over_limit: boolean;
}

/**
 * Reports whether the current user's tenant is over its plan limits.
 * Recomputed on demand (and on tenant change), so upgrades/customer
 * reductions automatically lift the restriction.
 */
export function useTenantLimit() {
  const { tenant, role } = useTenant();
  const [status, setStatus] = useState<TenantLimitStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!tenant?.id) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_tenant_limit_status", {
      p_tenant_id: tenant.id,
    });
    if (!error && data) setStatus(data as unknown as TenantLimitStatus);
    setLoading(false);
  }, [tenant?.id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { status, loading, refetch, role, tenant };
}

const LIMIT_ERROR_MARKER = "プランの上限を超えている";

export function isPlanLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
  return typeof msg === "string" && msg.includes(LIMIT_ERROR_MARKER);
}

export function planLimitMessage(role: string | null | undefined): string {
  if (role === "customer") {
    return i18n.t("hooks.planLimitCustomer");
  }
  if (role === "trainer") {
    return i18n.t("hooks.planLimitTrainer");
  }
  return i18n.t("hooks.planLimitGeneric");
}
