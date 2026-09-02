import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toJSTDate, formatJST } from "@/lib/timezone";
import { resolvePlanSlotMinutes } from "@/lib/planSlotDuration";
import {
  parseOptionSnapshot,
  readOptionMinutes,
  sessionMinutes,
  summarizeOptions,
  type BookingOptionSnapshot,
} from "@/lib/bookingOptions";

/**
 * 既に入っている予約のオプションを差し替える（**店側専用**）。
 *
 * 実店舗の要望（2026-09-03 宗本さん）:「あとからオプション追加したいっていう人も
 * いるかもなので追加して。でもそれはお店側で追加する。後ろがもう埋まってたら無理だしね」
 *
 * 🔴 **後ろが空いているかの判定は DB が正**（`guard_booking_option_change`、SQLSTATE `GB008`）。
 * 重複判定 `check_booking_overlap` は BEFORE INSERT にしか刺さっていないので、
 * この UPDATE 専用のトリガーが唯一の関門になる。ここを画面側の判定で代用しないこと。
 *
 * 🔴 お客様側からは呼ばない。伸ばせるかどうかは「後ろの予約」に依存し、それは
 * お客様には見えない（誰の予約かは他のお客様には出さない）。断られる理由を説明できない
 * 操作をお客様に出すと、原因の分からない失敗になる。
 *
 * ## 変わったらお客様に知らせる（2026-09-03 宗本さん「通知を足して」）
 *
 * 店側からの操作なので、黙って変えると**お客様は終了時刻が変わったことを知らない**。
 * 逆に「勝手に付けられた」とも見える。プッシュ＋メールの2本で知らせる
 * （キャンセル通知と同じ形）。**プッシュだけにしない**——許可していないお客様には
 * 何も届かないので、メールが唯一の控えになる。
 *
 * 中身が変わっていないとき（同じものを選び直して保存した）と、**過ぎた予約**には
 * 送らない。過ぎた予約の記録を直すのは事務作業で、お客様に知らせる話ではない。
 *
 * カレンダーは**消してから作り直す**。`google-calendar-sync` に「長さだけ変える」経路が
 * 無いため（create / delete / sync_all の3つしかない）。失敗しても予約の変更自体は成立させる
 * ——外部カレンダーのために店の操作を巻き戻すほうが害が大きい。
 */
export async function updateBookingOptions(
  bookingId: string,
  optionMinutes: number,
  bookingOptions: BookingOptionSnapshot[],
): Promise<{ error: unknown }> {
  const minutes = readOptionMinutes(optionMinutes);
  const snapshot = bookingOptions.length > 0 ? bookingOptions : null;

  // 変更前の姿を先に取る。通知の要否（変わったか）と、カレンダーの貼り替えに要る。
  // ⚠️ 列を明示列挙すると未適用のDBで 42703 になるため `*`（reschedule と同じ理由）。
  const { data: before } = await supabase
    .from("bookings").select("*").eq("id", bookingId).maybeSingle();

  const { error } = await supabase
    .from("bookings")
    .update({
      option_minutes: minutes,
      // 空配列ではなく null を入れる（「付いていない」を1つの表現にそろえる）
      booking_options: snapshot,
    } as never)
    .eq("id", bookingId);
  if (error) return { error };

  const row = before as Record<string, unknown> | null;
  if (row) {
    await resyncCalendar(row, minutes);
    const changed =
      readOptionMinutes(row.option_minutes) !== minutes ||
      summarizeOptions(parseOptionSnapshot(row.booking_options), plainMinutes) !==
        summarizeOptions(bookingOptions, plainMinutes);
    if (changed) await notifyCustomer(row, minutes, bookingOptions);
  }
  return { error: null };
}

/** 控えの比較用。表示ではないので言語に依存しない形にする。 */
const plainMinutes = (m: number) => `+${m}`;

/** 長さが変わったので、トレーナーの Googleカレンダーを作り直す（best-effort）。 */
async function resyncCalendar(row: Record<string, unknown>, minutes: number): Promise<void> {
  try {
    const eventId = row.google_event_id as string | null;
    if (eventId) {
      await supabase.functions.invoke("google-calendar-sync", {
        body: { action: "delete", booking_id: row.id, google_event_id: eventId },
      });
    }
    const { data: prof } = await supabase
      .from("profiles").select("display_name").eq("user_id", row.user_id as string).maybeSingle();
    await supabase.functions.invoke("google-calendar-sync", {
      body: {
        action: "create",
        booking_id: row.id,
        booking_date: row.booking_date,
        booking_type: row.booking_type,
        client_name: prof?.display_name || "顧客",
        option_minutes: minutes,
      },
    });
  } catch (e) {
    console.error("オプション変更後のカレンダー同期に失敗:", e);
  }
}

/**
 * お客様へプッシュ＋メール。どちらも fire-and-forget（失敗しても予約の変更は成立させる）。
 *
 * 🔴 文言はここに直接書く。この層（通知の送信）は既存のキャンセル通知・
 * 予約変更通知も日本語で直書きしており、i18n を通していない。ここだけ翻訳を通すと
 * 「どこで訳すのか」が2通りになる。多言語にするなら通知層をまとめて変えること。
 */
async function notifyCustomer(
  row: Record<string, unknown>,
  minutes: number,
  options: BookingOptionSnapshot[],
): Promise<void> {
  const bookingDate = row.booking_date as string;
  // 過ぎた予約は知らせない（記録の手直しであって、お客様への連絡ではない）
  if (new Date(bookingDate).getTime() < Date.now()) return;

  const userId = row.user_id as string;
  const tenantId = (row.tenant_id as string | null) ?? null;
  const bookingType = (row.booking_type as string | null) ?? "";

  // 変更後の時間帯。1枠（プラン優先）＋オプション。間はお客様の時間ではないので入れない。
  let slotMinutes = 60;
  let gymName: string | null = null;
  let gymNote: string | null = null;
  if (tenantId) {
    const [{ data: tenantRow }, { data: planRow }] = await Promise.all([
      supabase.from("tenants")
        .select("slot_duration_minutes, gym_name, booking_email_note").eq("id", tenantId).maybeSingle(),
      supabase.from("tenant_plans")
        .select("slot_duration_minutes").eq("tenant_id", tenantId).eq("plan_name", bookingType).maybeSingle(),
    ]);
    slotMinutes = resolvePlanSlotMinutes(
      bookingType,
      planRow ? [{ plan_name: bookingType, slot_duration_minutes: planRow.slot_duration_minutes }] : null,
      tenantRow?.slot_duration_minutes ?? 60,
    );
    gymName = (tenantRow?.gym_name as string | null) ?? null;
    gymNote = (tenantRow?.booking_email_note as string | null) ?? null;
  }

  const dt = toJSTDate(bookingDate);
  const startMin = dt.getHours() * 60 + dt.getMinutes();
  const endMin = startMin + sessionMinutes(slotMinutes, minutes);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const bookingTime = `${hhmm(startMin)}〜${hhmm(endMin)}`;
  const formattedDate = format(dt, "M月d日（E）", { locale: ja });
  const summary = summarizeOptions(options, (m) => `+${m}分`);
  const removed = options.length === 0;

  const { data: prof } = await supabase
    .from("profiles").select("display_name").eq("user_id", userId).maybeSingle();
  const customerName = prof?.display_name || "お客様";

  // 同じ内容を2回押しても2通にならないようにする（キャンセル通知と同じ作法）。
  // 分数と中身の両方を鍵に入れるので、外して付け直したときはちゃんともう1通出る。
  const key = `option-change-${row.id}-${minutes}-${options.map((o) => o.id).sort().join(",")}`;

  supabase.functions.invoke("send-push-notification", {
    body: {
      user_ids: [userId],
      title: removed ? "ご予約のオプションを取り消しました" : "ご予約のオプションが変わりました",
      body: removed
        ? `${formatJST(bookingDate, "M月d日", { locale: ja })} ${bookingTime} のご予約です`
        : `${formatJST(bookingDate, "M月d日", { locale: ja })} ${bookingTime} ／ ${summary}`,
      url: "/",
      tag: key,
    },
  }).catch((e) => console.error("オプション変更のプッシュ送信に失敗:", e));

  supabase.functions.invoke("send-transactional-email", {
    body: {
      templateName: "booking-option-changed",
      recipientEmail: "_resolve_user_",
      tenantId,
      idempotencyKey: key,
      templateData: {
        customerName,
        bookingDate: formattedDate,
        bookingTime,
        planName: bookingType,
        options,
        gymName: gymName ?? undefined,
        gymNote,
        resolveUserId: userId,
      },
    },
  }).catch((e) => console.error("オプション変更のメール送信に失敗:", e));
}
