/**
 * インストラクター（制限付きスタッフ）（2026-10-28）。
 *
 * 宗本さん（パーソナルピラティスの先生に来てもらう）:
 *   「お店の設定とか触らせたくないので、お店にログインできるということだけにさせたい。
 *    お知らせ・動画・設定は触らせないようにして、オーナーとは完全に分けてほしい。
 *    お客さんの削除もできないようにしてほしい。これはオーナーだけができるように」
 *
 * `tenant_members.staff_access`:
 *   - `full`    … オーナー（と、お客様の行の既定値。意味は無い）
 *   - `limited` … インストラクター。予約・顧客・メッセージ・種目は使えるが、店の運営は触れない
 *
 * 🔴 「スタッフ」（full の trainer）は 2026-10-28 になくした（宗本さん「スタッフいらない」・全部のジム）。
 *    ジム側の人はオーナーとインストラクターだけ。trainer は必ず limited（DB の CHECK
 *    tenant_members_trainer_is_instructor・`supabase/migrations/20261028050000_retire_full_staff.sql`）。
 *    full の trainer を前提にした分岐は、古いデータ・列の無い環境のために残している
 *
 * インストラクターの画面:
 *   - お知らせ・動画のタブを出さない。設定タブは「アカウント」（ログアウトだけ）に替える
 *   - ホームの売上・入金まわり、お客様の削除・退会・プランの変更・入金の記録、
 *     予定表の「受付を止める・上限を外す」を出さない
 *   - 店宛ての通知の宛先（代表・全員）にならない。自分が担当の予約だけ通知する
 *     （新しい予約・代理予約・日時の変更・キャンセル・担当の付け替え・オプションの変更・朝の本日の予定）
 *   - オーナーは全部の通知を受け取る（代表はオーナーが先頭・notifiableStaffOrder。
 *     オーナー以外が予約を動かしたらオーナーに届く・staffChangeRecipients）
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

/**
 * 店宛ての通知を送るスタッフの並び（インストラクターを除く）。**オーナーが先頭**。
 *
 * 🔴 先頭1人が「代表」＝店宛てのメール・LINE・お客様のチャットの宛先になる。
 *    2026-10-28 に trainer 優先から改めた（宗本さん「オーナーは全ての通知を受け取る」）。
 *    trainer 優先のままだと、インストラクターを「スタッフ」に切り替えた瞬間に
 *    店宛てのメールとチャットがオーナーから先生に移ってしまう。
 *    Edge Function（notify-new-booking / trial-book / drop-in-book / trial-cancel）も同じ順。
 */
export const notifiableStaffOrder = <T extends { user_id: string; role: string; staff_access?: unknown }>(
  rows: ReadonlyArray<T>,
): string[] => {
  const notifiable = notifiableStaff(rows);
  return [...new Set([
    ...notifiable.filter((r) => r.role === "owner").map((r) => r.user_id),
    ...notifiable.filter((r) => r.role === "trainer").map((r) => r.user_id),
  ])];
};

/**
 * 店側の操作（代理予約・担当の付け替え・オプションの変更）を知らせる相手（2026-10-28）。
 *
 * 宗本さん:「オーナーは全ての通知を受け取る」「先生には、先生が担当している予約だけ通知が届く様にして」
 *          「先生に関する通知は先生に届くように」
 *
 * - その予約の担当（付け替えなら前と後の両方）… 自分の担当の予約のことなので
 * - オーナー以外（インストラクター・スタッフ）が操作したら、オーナー … オーナーが全部を把握できるように
 * - 操作した本人には送らない（自分の操作の通知は要らない）
 *
 * 🔴 「インストラクターが操作したら」ではなく「オーナー以外が操作したら」にしてある。
 *    先生をあとで「スタッフ」に切り替えても、オーナーに届かなくならないように。
 * オーナーが自分で担当のいない予約を操作したときは、誰にも送らない（今まで通り）。
 * notify-new-booking（代理予約のプッシュ）も同じ規則。
 */
export const staffChangeRecipients = (
  roster: { owners: ReadonlyArray<string> },
  actorId: string | null | undefined,
  assigned: ReadonlyArray<string | null | undefined>,
): string[] => {
  const actorIsOwner = !!actorId && roster.owners.includes(actorId);
  return [...new Set([
    ...assigned.filter((id): id is string => !!id),
    ...(actorIsOwner ? [] : roster.owners),
  ])].filter((id) => id !== actorId);
};
