/**
 * 店側の操作（担当の付け替え・オプションの変更）を、操作した本人以外の関係者に知らせる（2026-10-28）。
 *
 * 宗本さん:「オーナーは全ての通知を受け取る」「先生には、先生が担当している予約だけ通知が届く様にして」
 *          「先生に関する通知は先生に届くように」
 *
 * 宛先は `staffChangeRecipients`（src/lib/staffAccess.ts）:
 *   - その予約の担当（付け替えなら前と後の両方）
 *   - オーナー以外（インストラクター・スタッフ）が操作したなら、オーナー
 *   - 操作した本人は除く
 * オーナーが自分で担当のいない予約を操作したときは、誰にも送らない（今まで通り）。
 *
 * 新しい予約（代理予約を含む）は notify-new-booking（サーバー側）が同じ規則で送る。
 * どちらも fire-and-forget（通知に失敗しても操作そのものは成立させる）。
 *
 * 🔴 文言はここに直接書く（キャンセル通知・予約変更通知と同じく、通知層は i18n を通していない）。
 */
import { ja } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { formatJST } from "@/lib/timezone";
import { fetchMyTenantStaffRoster } from "@/lib/tenantHelper";
import { staffChangeRecipients } from "@/lib/staffAccess";

const currentUserId = async (): Promise<string | null> =>
  (await supabase.auth.getSession()).data.session?.user?.id ?? null;

const push = (userIds: string[], title: string, body: string, tag: string) =>
  supabase.functions
    .invoke("send-push-notification", { body: { user_ids: userIds, title, body, url: "/", tag } })
    .catch((e) => console.error(`${title} のプッシュに失敗:`, e));

/**
 * 予約の担当を付け替えたとき。前の担当・新しい担当（と、オーナー以外が操作したならオーナー）に知らせる。
 * @param date JST の yyyy-MM-dd
 * @param startTime "HH:MM"
 */
export async function notifyStaffReassigned(params: {
  bookingId: string;
  clientName: string;
  date: string;
  startTime: string;
  fromStaffId: string | null;
  toStaffId: string | null;
}): Promise<void> {
  const { bookingId, clientName, date, startTime, fromStaffId, toStaffId } = params;
  if (fromStaffId === toStaffId) return;
  try {
    const [roster, actor] = await Promise.all([fetchMyTenantStaffRoster(), currentUserId()]);
    const to = staffChangeRecipients(roster, actor, [fromStaffId, toStaffId]);
    if (to.length === 0) return;
    const nameOf = (id: string | null) => (id ? roster.names[id] || "スタッフ" : "指名なし");
    const when = formatJST(`${date}T${startTime}:00+09:00`, "M月d日 HH:mm", { locale: ja });
    await push(
      to,
      "予約の担当の変更",
      `${clientName}様 ${when} の予約の担当: ${nameOf(fromStaffId)} → ${nameOf(toStaffId)}`,
      `staff-reassign-${bookingId}`,
    );
  } catch (e) {
    console.error("担当の変更の通知に失敗:", e);
  }
}

/**
 * 店が予約のオプションを変えたとき（終了時刻が変わる）。その予約の担当（と、オーナー以外が
 * 操作したならオーナー）に知らせる。お客様への通知は bookingOptionEdit.ts が別に送る。
 * @param bookingDate 予約の開始（ISO）
 * @param summary 付いたオプションの要約（外したなら空）
 */
export async function notifyStaffOptionChanged(params: {
  bookingId: string;
  clientName: string;
  bookingDate: string;
  bookingTime: string;
  assignedStaffId: string | null;
  summary: string;
}): Promise<void> {
  const { bookingId, clientName, bookingDate, bookingTime, assignedStaffId, summary } = params;
  try {
    const [roster, actor] = await Promise.all([fetchMyTenantStaffRoster(), currentUserId()]);
    const to = staffChangeRecipients(roster, actor, [assignedStaffId]);
    if (to.length === 0) return;
    const day = formatJST(bookingDate, "M月d日", { locale: ja });
    await push(
      to,
      "予約のオプションの変更",
      `${clientName}様 ${day} ${bookingTime}${summary ? ` ／ ${summary}` : "（オプションなし）"}`,
      `staff-option-${bookingId}`,
    );
  } catch (e) {
    console.error("オプションの変更の通知に失敗:", e);
  }
}
