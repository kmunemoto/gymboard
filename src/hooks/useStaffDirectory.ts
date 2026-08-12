import { useMemo } from "react";
import { useTenantStaff } from "@/hooks/useTenantStaff";

export interface StaffDirectory {
  /** 自テナントのジム側スタッフ（owner + trainer、在籍中）の user_id */
  ids: string[];
  /** user_id → 表示名 */
  names: Map<string, string>;
  loading: boolean;
}

/**
 * 共有受信箱のための「ジム側スタッフ一覧」。
 *
 * ## なぜ集合で扱うのか
 * チャットの行は 1対1（`sender_id` / `receiver_id`）で持っている。
 * お客様の宛先は代表スタッフ1名に固定されていたので、
 *
 *   ・その人が休みだと**会話が止まる**
 *   ・退職・担当替えで**履歴が切れる**（別の人に送ると別の会話になる）
 *   ・未読はその人にしか出ない
 *
 * 行の持ち方は変えず、**読むときにスタッフ全員をひとまとまりとして扱う**。
 * データ移行なしで共有受信箱になる。
 *
 * ⚠️ 中身は既存の `useTenantStaff` をそのまま使う。名前を `profiles` ではなく
 *    `tenant_members.display_name` から取っているのが重要で、**お客様は他人の
 *    profiles を読めない**（`src/lib/tenantStaff.ts` の冒頭に理由）。
 *    ここを profiles に変えると、お客様側でだけ名前が出なくなる。
 */
export const useStaffDirectory = (): StaffDirectory => {
  const { staff, loading } = useTenantStaff();

  const ids = useMemo(() => staff.map((s) => s.user_id), [staff]);
  const names = useMemo(
    () => new Map(staff.map((s) => [s.user_id, s.display_name] as const)),
    [staff],
  );

  return { ids, names, loading };
};
