import { supabase } from "@/integrations/supabase/client";

/**
 * Get the current user's active tenant_id directly (no React hook).
 * Use inside non-React utility functions or async flows that don't have access
 * to useTenant(). Returns null if the user isn't signed in or has no membership.
 *
 * 🔴 getUser() ではなく getSession() を使う。getUser() はセッションの有無に関わらず
 * **毎回 /auth/v1/user へ HTTPS GET を撃ち**、失敗しても throw せず user=null を返す
 * （リトライも無い）。この null が「所属なし」と区別できず、モバイル回線の瞬断だけで
 * 店への予約通知が黙って消えていた（2026-08-21 の沈黙故障。詳細は
 * mem/features/booking-notify-server-side.md）。getSession() は localStorage 読みで、
 * 期限内ならネットワークに出ない。後続の PostgREST リクエストはどのみち
 * getSession() のトークンで飛ぶので、getUser() の追加往復に意味は無かった。
 */
export async function fetchMyTenantId(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
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
 * 現在ログイン中のユーザーが所属するテナントの「ジム側スタッフ」全員の user_id を返す。
 * 並び順は trainer（joined_at昇順）→ owner（同）。先頭1件を LINE/メールの代表宛先として
 * 使う箇所があるため、この順序は fetchMyTenantTrainerId の解決結果と一致させている。
 *
 * get_trainer_ids() は user_roles を全テナント横断で返すため、通知が別ジムのトレーナーに
 * 飛ぶ/自ジムに届かない不具合の原因になっていた（チャット #141・予約系通知）。
 * ここではテナント内で解決する。tenant_members の SELECT RLS
 * 「Members can view same tenant members」により、お客様も自テナントのスタッフ行を読める。
 */
export async function fetchMyTenantStaffIds(): Promise<string[]> {
  const tenantId = await fetchMyTenantId();
  if (!tenantId) return [];
  const { data } = await supabase
    .from("tenant_members")
    .select("user_id, role, joined_at")
    .eq("tenant_id", tenantId)
    .in("role", ["trainer", "owner"])
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  const rows = (data ?? []) as { user_id: string; role: string }[];
  const trainers = rows.filter((m) => m.role === "trainer");
  const owners = rows.filter((m) => m.role === "owner");
  return [...new Set([...trainers, ...owners].map((m) => m.user_id))];
}

/**
 * 自テナントの代表スタッフ1件（trainer 優先、居なければ owner。
 * Salute のような一人ジムはオーナーのみ）。見つからなければ null。
 */
export async function fetchMyTenantTrainerId(): Promise<string | null> {
  const ids = await fetchMyTenantStaffIds();
  return ids[0] ?? null;
}

/**
 * 自テナントのジム名。メールの差出人名など「そのジムの名前で送りたい」場面で使う。
 * 取得できなければ null（呼び出し側で製品名にフォールバックする想定）。
 */
export async function fetchMyTenantGymName(): Promise<string | null> {
  const tenantId = await fetchMyTenantId();
  if (!tenantId) return null;
  const { data } = await supabase
    .from("tenants")
    .select("gym_name")
    .eq("id", tenantId)
    .maybeSingle();
  return (data?.gym_name as string | null) ?? null;
}

/**
 * Attach tenant_id to a row payload. Throws if tenantId is missing so we never
 * insert rows that would be invisible to everyone after tenant-isolation RLS.
 */
export function withTenant<T extends Record<string, any>>(data: T, tenantId: string | null | undefined): T & { tenant_id: string } {
  if (!tenantId) throw new Error("テナントが見つかりません。ログインし直してください。");
  return { ...data, tenant_id: tenantId };
}
