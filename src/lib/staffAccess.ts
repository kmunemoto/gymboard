/**
 * インストラクター（制限付きスタッフ）（2026-10-28）。
 *
 * 宗本さん（パーソナルピラティスの先生に来てもらう）:
 *   「お店の設定とか触らせたくないので、お店にログインできるということだけにさせたい。
 *    お知らせ・動画・設定は触らせないようにして、オーナーとは完全に分けてほしい。
 *    お客さんの削除もできないようにしてほしい。これはオーナーだけができるように」
 *
 * `tenant_members.staff_access`:
 *   - `full`    … 今まで通りのスタッフ（既定）
 *   - `limited` … インストラクター。予約・顧客・メッセージ・種目は使えるが、店の運営は触れない
 *
 * インストラクターの画面:
 *   - お知らせ・動画のタブを出さない。設定タブは「アカウント」（ログアウトだけ）に替える
 *   - ホームの売上・入金まわり、お客様の削除・退会・プランの変更・入金の記録、
 *     予定表の「受付を止める・上限を外す」を出さない
 *   - 店宛ての通知の宛先（代表・全員）にならない。自分が担当の予約だけ通知する
 *
 * 🔴 画面で隠すのは使い勝手のため。止めているのは DB（RESTRICTIVE のポリシー・
 *    delete_customer_cascade・guard_profile_plan_fields。
 *    `supabase/migrations/20261028020000_instructor_staff.sql`）。
 */
import type { TrainerTab } from "@/lib/trainerTabs";

export type StaffAccess = "full" | "limited";

/** DB の値を読む。分からない値は今まで通り（full）に倒す（止めているのは DB なので、画面は今まで通りでよい） */
export const parseStaffAccess = (value: unknown): StaffAccess => (value === "limited" ? "limited" : "full");

/** インストラクター（制限付きスタッフ）か。オーナー・お客様は常に false */
export const isLimitedStaffRole = (
  role: string | null | undefined,
  access: StaffAccess | null | undefined,
): boolean => role === "trainer" && access === "limited";

/** インストラクターに出さないタブ。設定タブは出すが、中身を「アカウント」だけにする */
export const LIMITED_HIDDEN_TABS: readonly TrainerTab[] = ["announcements", "videos"];

/** そのタブを開けるか */
export const canOpenTab = (tab: TrainerTab, limited: boolean): boolean => !limited || !LIMITED_HIDDEN_TABS.includes(tab);

/**
 * 店宛ての通知を送るスタッフ。インストラクターは外す（代表の宛先にも、全員宛ての通知にも入れない）。
 * 予約の担当がインストラクターなら、その予約の通知だけは届ける（`withAssignedStaff`）。
 */
export const notifiableStaff = <T extends { staff_access?: unknown }>(rows: ReadonlyArray<T>): T[] =>
  rows.filter((r) => parseStaffAccess(r.staff_access) !== "limited");

/** 通知の宛先に、その予約の担当（インストラクターを含む）を足す */
export const withAssignedStaff = (ids: ReadonlyArray<string>, staffUserId: string | null | undefined): string[] =>
  [...new Set([...ids, ...(staffUserId ? [staffUserId] : [])])];
