import { supabase } from "@/integrations/supabase/client";
import { notifiableStaffOrder } from "@/lib/staffAccess";

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

/** 店のスタッフの並び（fetchMyTenantStaffRoster）。 */
export interface MyTenantStaffRoster {
  /** 店宛ての通知を送るスタッフ（インストラクターを除く）。**オーナーが先頭**（先頭1人が代表） */
  ids: string[];
  /** オーナー。オーナー以外が予約を動かしたら知らせる（staffChangeRecipients） */
  owners: string[];
  /** 表示名（通知の本文用）。読めなければ空 */
  names: Record<string, string>;
}

/**
 * 現在ログイン中のユーザーが所属するテナントのスタッフ（オーナー・スタッフ・インストラクター）。
 *
 * get_trainer_ids() は user_roles を全テナント横断で返すため、通知が別ジムのトレーナーに
 * 飛ぶ/自ジムに届かない不具合の原因になっていた（チャット #141・予約系通知）。
 * ここではテナント内で解決する。tenant_members の SELECT RLS
 * 「Members can view same tenant members」により、お客様も自テナントのスタッフ行を読める。
 *
 * 🔴 並びは**オーナーが先頭**（2026-10-28 に trainer 優先から改めた・src/lib/staffAccess.ts の
 *    notifiableStaffOrder）。インストラクター（staff_access = 'limited'）は ids に入れない。
 *    入れると代表になりうる＝店宛ての通知・お客様のチャットの宛先が先生に移る。
 *    権限の列が無い環境では列を外して読み直す（全員を今まで通りのスタッフとして扱う）。
 */
export async function fetchMyTenantStaffRoster(): Promise<MyTenantStaffRoster> {
  const tenantId = await fetchMyTenantId();
  if (!tenantId) return { ids: [], owners: [], names: {} };
  const query = (cols: string) =>
    supabase
      .from("tenant_members")
      .select(cols)
      .eq("tenant_id", tenantId)
      .in("role", ["trainer", "owner"])
      .eq("status", "active")
      .order("joined_at", { ascending: true });
  const first = await query("user_id, role, joined_at, display_name, staff_access");
  const { data } = first.error ? await query("user_id, role, joined_at, display_name") : first;
  const rows = (data ?? []) as unknown as { user_id: string; role: string; display_name?: string | null; staff_access?: unknown }[];
  return {
    ids: notifiableStaffOrder(rows),
    owners: rows.filter((r) => r.role === "owner").map((r) => r.user_id),
    names: Object.fromEntries(rows.map((r) => [r.user_id, r.display_name?.trim() || ""]).filter(([, n]) => n)),
  };
}

/**
 * 店宛ての通知を送るスタッフの user_id（インストラクターを除く・オーナーが先頭）。
 * 先頭1件を LINE/メールの代表宛先として使う箇所があるため、fetchMyTenantTrainerId と同じ並び。
 */
export async function fetchMyTenantStaffIds(): Promise<string[]> {
  return (await fetchMyTenantStaffRoster()).ids;
}

/**
 * 自テナントの代表スタッフ1件（**オーナー**。居なければ先頭のスタッフ。インストラクターは除く）。
 * 店宛てのメール・LINE・お客様のチャットの宛先。見つからなければ null。
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
