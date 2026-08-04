/**
 * 「そのジムのスタッフ（担当できる人）」の一覧。予約の担当者選択に使う。
 *
 * ## 名前をどこから取るか
 * `profiles` はお客様から他人の行を読めない（profiles_tenant_scope_select は
 * 自分の行 か トレーナー のみ）。一方 `tenant_members` は
 * 「Members can view same tenant members」で同じジムのメンバー行を読めるので、
 * **表示名は tenant_members.display_name を使う**。
 * オーナー行は Onboarding、お客様行は JoinGym、スタッフ行は
 * join_tenant_as_staff_with_invite_code がそれぞれ display_name を入れている。
 *
 * ## 業種による呼び方の違い
 * 「トレーナー」「施術者」「コーチ」「担当者」…は業種で変わるので、
 * このファイルは**語彙を持たない**（`staff` で統一）。画面に出る文言は i18n キー
 * （`staff.*`）にしてあり、兄弟アプリは `src/locales/vertical.ja.json` の
 * オーバーレイだけで言い換えられる。
 */
import { supabase } from "@/integrations/supabase/client";

export interface TenantStaff {
  user_id: string;
  display_name: string;
  role: "owner" | "trainer";
}

/** 担当者を選べる状態か（1人しか居ないジムでは選ばせる意味が無いので出さない）。 */
export const STAFF_SELECTION_MIN = 2;

export function canSelectStaff(staff: ReadonlyArray<TenantStaff>): boolean {
  return staff.length >= STAFF_SELECTION_MIN;
}

/**
 * 指定テナントの現役スタッフ（owner / trainer）を参加順に返す。
 * 参加順にしているのは、オーナー（＝ジムを作った人）が自然に先頭に来るため。
 * 表示名が空の行は user_id の断片で埋める（選択肢が空欄になって選べなくなるのを防ぐ）。
 */
export async function fetchTenantStaff(tenantId: string | null | undefined): Promise<TenantStaff[]> {
  if (!tenantId) return [];
  const { data, error } = await supabase
    .from("tenant_members")
    .select("user_id, role, display_name, joined_at")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "trainer"])
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  if (error || !data) return [];
  const seen = new Set<string>();
  const staff: TenantStaff[] = [];
  for (const row of data as { user_id: string; role: string; display_name: string | null }[]) {
    if (!row.user_id || seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    staff.push({
      user_id: row.user_id,
      display_name: row.display_name?.trim() || row.user_id.slice(0, 8),
      role: row.role === "owner" ? "owner" : "trainer",
    });
  }
  return staff;
}

/**
 * DB が「担当者が埋まっている」で拒否したか。
 *
 * 「店が満枠」と同じ文言で出すと、**別の担当なら取れる**ことに気づけない。
 * 判定は SQLSTATE 'GB001'（20260804000000_booking_staff_assignment.sql が
 * この用途専用に付けている）で行う。文言一致にしないのは、業種フォークが
 * メッセージを言い換えた瞬間に静かに壊れるため。
 */
export function isStaffConflictError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "GB001";
}

/** user_id → 表示名。予定表のカードなどで引くための辞書。 */
export function staffNameMap(staff: ReadonlyArray<TenantStaff>): Record<string, string> {
  const map: Record<string, string> = {};
  staff.forEach((s) => { map[s.user_id] = s.display_name; });
  return map;
}

/**
 * 担当を選んだときに、その枠が「その担当にとって」埋まっているか。
 *
 * 店全体の判定（同時受入数・ブロック枠）とは別物で、**重ねて**使う。
 * DB 側の check_booking_overlap も同じ二段構えで最終判定する
 * （店全体が空いていても、担当が埋まっていれば拒否）。
 *
 * staffUserId が null（指名なし）のときは常に false。指名なしの予約は
 * 担当者単位の制約を受けないため。
 */
export function isStaffBusy(
  slots: ReadonlyArray<{ startMin: number; endMin: number; staffUserId: string | null }>,
  staffUserId: string | null,
  newStartMin: number,
  newEndMin: number,
): boolean {
  if (!staffUserId) return false;
  return slots.some(
    (s) => s.staffUserId === staffUserId && newStartMin < s.endMin && s.startMin < newEndMin,
  );
}
