import { supabase } from "@/integrations/supabase/client";

/**
 * Get the current user's active tenant_id directly (no React hook).
 * Use inside non-React utility functions or async flows that don't have access
 * to useTenant(). Returns null if the user isn't signed in or has no membership.
 */
export async function fetchMyTenantId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  return (data as any)?.tenant_id ?? null;
}

/**
 * Attach tenant_id to a row payload. Throws if tenantId is missing so we never
 * insert rows that would be invisible to everyone after tenant-isolation RLS.
 */
export function withTenant<T extends Record<string, any>>(data: T, tenantId: string | null | undefined): T & { tenant_id: string } {
  if (!tenantId) throw new Error("テナントが見つかりません。ログインし直してください。");
  return { ...data, tenant_id: tenantId };
}
