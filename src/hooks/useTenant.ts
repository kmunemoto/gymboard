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
  same_day_cancel_penalty_enabled: boolean;
  invite_code?: string;
  status: string;
  gymboard_plan: string;
  max_customers: number | null;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
}

export interface TenantPlan {
  id: string;
  tenant_id: string;
  plan_name: string;
  plan_type: string;
  max_sessions: number | null;
  price: number;
  validity_days: number | null;
  /** サブスクのサイクル月数（応当日ベース）。null/未設定は1ヶ月 */
  cycle_months: number | null;
  /** サブスクの猶予日数。期限超過後この日数までは前サイクル分として大目に見る。null/未設定は0 */
  grace_days: number | null;
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

  const fetchMembership = async () => {
    if (!user) {
      setMembership(null);
      setPlans([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      // 基本カラムと、後から追加した same_day_cancel_penalty_enabled を分けて持つ。
      // 新カラムを含む select は、対象環境でマイグレーション未適用だと
      // 「column does not exist」でクエリ全体が失敗し、tenant が読めず
      // アプリ全体（プラン管理のロード等）が壊れる。そのため新カラム込みで試し、
      // 失敗したら新カラム抜きで再取得して flag は false 扱いにフォールバックする。
      const TENANT_BASE_COLS =
        "id, gym_name, gym_name_short, business_type, logo_url, primary_color, address, phone, email, website_url, operating_hours, slot_duration_minutes, booking_cutoff_type, booking_cutoff_hours, status, gymboard_plan, max_customers, subscription_status, trial_ends_at";
      const memberQuery = (tenantCols: string) =>
        supabase
          .from("tenant_members")
          .select(`role, plan_id, tenants:tenant_id(${tenantCols})`)
          .eq("user_id", user.id)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();

      let { data: mem, error: memErr } = await memberQuery(
        `${TENANT_BASE_COLS}, same_day_cancel_penalty_enabled`,
      );
      if (memErr) {
        // 新カラム未適用等でエラー → 基本カラムのみで再取得（機能はOFF扱いで安全に動作）
        console.warn("useTenant: same_day_cancel_penalty_enabled 付きのtenant取得に失敗。基本カラムで再取得します。", memErr.message);
        ({ data: mem } = await memberQuery(TENANT_BASE_COLS));
      }
      if (cancelled) return;
      if (mem && mem.tenants) {
        const raw = mem.tenants as unknown as Record<string, unknown>;
        const tenant = {
          ...raw,
          same_day_cancel_penalty_enabled: raw.same_day_cancel_penalty_enabled === true,
        } as unknown as Tenant;
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
  };

  useEffect(() => {
    let cleanupFn: (() => void) | undefined;
    fetchMembership().then((fn) => { cleanupFn = fn; });
    return () => { cleanupFn?.(); };
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
