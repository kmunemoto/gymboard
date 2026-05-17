import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve the gym (tenant) name for a given user_id.
 * Falls back to the platform brand "ジムボード" if the user has not joined a tenant
 * or the lookup fails.
 */
export async function getGymNameForUser(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("tenant_members")
      .select("tenants:tenant_id(gym_name)")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    const name = (data as any)?.tenants?.gym_name as string | undefined;
    return name || "ジムボード";
  } catch {
    return "ジムボード";
  }
}
