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
 * 現在ログイン中のユーザーが所属するテナントの「ジム側スタッフ」の user_id を1件返す。
 * trainer を優先し、居なければ owner（Salute のような一人ジムはオーナーのみ）。
 *
 * get_trainer_ids() は user_roles を全テナント横断で返すため、その先頭は別ジムの
 * トレーナーになりうる（お客様のチャットが別ジムに飛び、自ジムに届かない不具合の原因）。
 * ここではテナント内で解決する。tenant_members の SELECT RLS
 * 「Members can view same tenant members」により、お客様は自テナントのスタッフ行を読める。
 * 見つからなければ null。
 */
export async function fetchMyTenantTrainerId(): Promise<string | null> {
  const tenantId = await fetchMyTenantId();
  if (!tenantId) return null;
  const { data } = await supabase
    .from("tenant_members")
    .select("user_id, role, joined_at")
    .eq("tenant_id", tenantId)
    .in("role", ["trainer", "owner"])
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  const rows = (data ?? []) as { user_id: string; role: string }[];
  const staff = rows.find((m) => m.role === "trainer") ?? rows[0];
  return staff?.user_id ?? null;
}

/**
 * Attach tenant_id to a row payload. Throws if tenantId is missing so we never
 * insert rows that would be invisible to everyone after tenant-isolation RLS.
 */
export function withTenant<T extends Record<string, any>>(data: T, tenantId: string | null | undefined): T & { tenant_id: string } {
  if (!tenantId) throw new Error("テナントが見つかりません。ログインし直してください。");
  return { ...data, tenant_id: tenantId };
}
