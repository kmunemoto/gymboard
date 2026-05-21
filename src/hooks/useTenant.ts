import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Tenant {
  id: string;
  gym_name: string;
  gym_name_short: string | null;
  business_type: string;
  logo_url: string | null;
  primary_color: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  operating_hours: { start: string; end: string };
  slot_duration_minutes: number;
  booking_cutoff_type: string;
  booking_cutoff_hours: number;
  invite_code: string;
  status: string;
  gymboard_plan: string;
  max_customers: number;
}

export interface TenantPlan {
  id: string;
  tenant_id: string;
  plan_name: string;
  plan_type: string;
  max_sessions: number | null;
  price: number;
  validity_days: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface TenantMembership {
  tenant: Tenant;
  role: "owner" | "trainer" | "customer";
  plan_id: string | null;
}

export function useTenant() {
  const { user } = useAuth();
  const [membership, setMembership] = useState<TenantMembership | null>(null);
  const [plans, setPlans] = useState<TenantPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setMembership(null);
      setPlans([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: mem } = await supabase
        .from("tenant_members")
        .select("role, plan_id, tenants:tenant_id(*)")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (mem && mem.tenants) {
        const tenant = mem.tenants as unknown as Tenant;
        setMembership({
          tenant,
          role: (mem as any).role,
          plan_id: (mem as any).plan_id,
        });
        const { data: planRows } = await supabase
          .from("tenant_plans")
          .select("*")
          .eq("tenant_id", tenant.id)
          .eq("is_active", true)
          .order("sort_order");
        if (!cancelled) setPlans((planRows as TenantPlan[]) || []);
      } else {
        setMembership(null);
        setPlans([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  return {
    membership,
    tenant: membership?.tenant ?? null,
    role: membership?.role ?? null,
    plans,
    loading,
    refetch: fetchMembership,
  };
}
