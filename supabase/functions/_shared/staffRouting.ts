/**
 * お客様の操作を店に知らせるときの宛先の振り分け（Edge Function 用・2026-10-28）。
 *
 * 宗本さん:「お客様→代表の1人+先生、もしくは、お客様→代表の1人。これを考えて使い分けて」
 *
 * - **代表の1人**（オーナー優先・インストラクター除く）には、いつでも届ける（オーナーは全部を受け取る）
 * - **先生（代表以外のスタッフ）** には、そのお客様・その予約が先生に関係するときだけ足す
 *     - 予約の通知 … その予約の担当
 *     - チャット … そのお客様の予約の担当（30日前から先）か、30日以内にそのお客様へメッセージを送った人
 *
 * クライアントの `src/lib/staffAccess.ts`（notifiableStaffOrder・staffChangeRecipients）と同じ考え方。
 * DB を読むのは各 Edge Function。ここは判定だけ（import なし＝vitest からも読める）。
 * テストは `src/test/staffNotifications.test.ts`。
 */

export interface StaffRow {
  user_id: string;
  role: string;
  staff_access?: string | null;
}

/** 店の代表（オーナー優先・インストラクター除く）。居なければ null */
export const representativeOf = (staff: ReadonlyArray<StaffRow>): string | null => {
  const notLimited = staff.filter((s) => (s.role === "owner" || s.role === "trainer") && s.staff_access !== "limited");
  return (notLimited.find((s) => s.role === "owner") ?? notLimited[0])?.user_id ?? null;
};

/** チャットで「そのお客様の担当」とみなす期間（日）。予約は30日前から先、メッセージは30日以内 */
export const RELATED_DAYS = 30;

/**
 * チャットのプッシュを送る相手。
 *
 * お客様から店（スタッフ）宛てのメッセージは、行の宛先に関係なく「代表＋関係するスタッフ」。
 * 行の宛先は、今のアプリでは代表（オーナー）、出回っている古いアプリでは「スタッフ優先」で選んだ人
 * （先生がいると先生）になるので、宛先ではなく関係で決める。
 * スタッフ同士・店からお客様へのメッセージは宛先のまま。
 *
 * @param staff 店の現役スタッフ（owner / trainer）
 * @param related 代表以外で、そのお客様に関係するスタッフ（予約の担当・最近メッセージを送った人）
 */
export const chatRecipients = (args: {
  senderId: string;
  receiverId: string;
  staff: ReadonlyArray<StaffRow>;
  related: ReadonlyArray<string>;
}): string[] => {
  const staffIds = args.staff.map((s) => s.user_id);
  if (!staffIds.includes(args.receiverId) || staffIds.includes(args.senderId)) return [args.receiverId];
  const rep = representativeOf(args.staff);
  const out = [...new Set([...(rep ? [rep] : []), ...args.related.filter((id) => staffIds.includes(id))])];
  return out.length > 0 ? out : [args.receiverId];
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * 店の「代表」宛てのメールの冪等キー（末尾が予約 id だけ）。
 * `cancel-trainer-<予約id>`（キャンセル）・`booking-notify-<予約id>`（新しい予約）。
 * 予約の担当宛ての写しには `-<user_id>` / `-staff` が付くので当たらない。
 */
export const REPRESENTATIVE_KEY = new RegExp(`^(?:cancel-trainer|booking-notify)-${UUID}$`);

/** キャンセルの代表キーなら予約 id。ほか（新しい予約のキーなど）は null */
export const cancelledBookingIdOf = (key: string): string | null => {
  const m = key.match(new RegExp(`^cancel-trainer-(${UUID})$`));
  return m ? m[1] : null;
};

/**
 * 古いアプリが代表のつもりで先生（インストラクター）に送った店宛てメールの送り先。
 *
 * - 新しい予約（`booking-notify-<予約id>`）… 代表だけ。先生の担当なら、サーバー（notify-new-booking）が
 *   `-staff` のキーで先生に別に送っている
 * - キャンセル（`cancel-trainer-<予約id>`）… 先生の担当の予約なら「代表＋先生」、そうでなければ「代表だけ」。
 *   担当が分からない（`undefined`）ときは先生にも送る（届かないより、届くほうがまし）
 *
 * @returns to = このメールの送り先（代表）。copyTo = 先生にも写しを送るなら先生（今のアプリと同じ `-<user_id>` のキーで）
 */
export const resendTargets = (args: {
  key: string;
  instructorId: string;
  representativeId: string;
  bookingStaff: string | null | undefined;
}): { to: string; copyTo: string | null } => {
  if (!cancelledBookingIdOf(args.key)) return { to: args.representativeId, copyTo: null };
  const hers = args.bookingStaff === undefined || args.bookingStaff === args.instructorId;
  return { to: args.representativeId, copyTo: hers ? args.instructorId : null };
};

/**
 * 「店のスタッフ全員」宛ての予約のプッシュのタグ（src/hooks/useBookings.ts・notify-new-booking）。
 * どの予約の話かを読む。当たらなければ null（振り分けない）。
 *   - `booking-<予約id>` … 新しい予約
 *   - `booking-cancel-trainer-<お客様>-<予約日時>` … キャンセル（予約日時は ISO 文字列）
 *   - `reschedule-<お客様>-<yyyy-MM-dd>` … 日時の変更（新しい日付）
 */
export type BookingPushTag =
  | { kind: "booking"; bookingId: string }
  | { kind: "cancel"; customerId: string; bookingDate: string }
  | { kind: "reschedule"; customerId: string; day: string };

export const parseBookingPushTag = (tag: unknown): BookingPushTag | null => {
  if (typeof tag !== "string") return null;
  const booking = tag.match(new RegExp(`^booking-(${UUID})$`));
  if (booking) return { kind: "booking", bookingId: booking[1] };
  const cancel = tag.match(new RegExp(`^booking-cancel-trainer-(${UUID})-(.+)$`));
  if (cancel) return Number.isNaN(Date.parse(cancel[2])) ? null : { kind: "cancel", customerId: cancel[1], bookingDate: cancel[2] };
  const reschedule = tag.match(new RegExp(`^reschedule-(${UUID})-(\\d{4}-\\d{2}-\\d{2})$`));
  if (reschedule) return { kind: "reschedule", customerId: reschedule[1], day: reschedule[2] };
  return null;
};

/**
 * その予約の担当でないインストラクター（先生）を宛先から外す。オーナー・スタッフ・お客様は外さない。
 * 担当が分からない（`assigned` が null）ときは外さない（届かないより、届くほうがまし）。
 */
export const keepAssignedInstructors = (
  userIds: ReadonlyArray<string>,
  instructors: ReadonlySet<string>,
  assigned: ReadonlySet<string> | null,
): string[] => (assigned === null ? [...userIds] : userIds.filter((id) => !instructors.has(id) || assigned.has(id)));
