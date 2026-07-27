import { supabase } from "@/integrations/supabase/client";
import { ja } from "date-fns/locale";
import { getWebOrigin } from "@/lib/nativeBridge";
import { fetchMyTenantTrainerId, fetchMyTenantGymName } from "@/lib/tenantHelper";
import { formatJST } from "@/lib/timezone";
import { devLog } from "@/lib/devLog";

const logEmailInvoke = (
  context: string,
  templateName: string,
  recipientEmail: string,
  result: Awaited<ReturnType<typeof supabase.functions.invoke>>,
) => {
  devLog("予約メール送信レスポンス", {
    context,
    templateName,
    recipientEmail,
    status: result.error ? "error" : "ok",
    body: result.data ?? result.error,
  });
};

/** 作成された予約1件分（日付は yyyy-MM-dd）。 */
export interface CreatedBooking {
  id: string;
  date: string;
}

/**
 * 予約のメールを送る（トレーナーへの新規予約通知 + お客様への受付確認）。
 *
 * **引数は配列。定期予約で作成した全件をそのまま渡すこと。**
 * 以前は1件目だけを受け取る作りで、呼び出し側が `booked[0]` を渡していたため、
 * 定期予約の2回目以降にメールが届かなかった。
 *
 * 予約ごとに1通ずつ送る。各回は別日の予定であり、テンプレートも日時を1つしか
 * 持たないため、まとめて1通にすると「どの回の確認か」が分からなくなる。
 * メールはEdge Function側でキューに積まれる（レート制限は dispatcher が面倒を見る）。
 *
 * Fire-and-forget — errors are logged but never block the UI.
 */
export const sendBookingNotifications = async (
  bookings: CreatedBooking[],
  customerName: string,
  startTime: string,
  endTime: string,
  planName: string,
  customerUserId?: string,
  customerEmail?: string,
) => {
  if (bookings.length === 0) return;
  try {
    // 宛先は自テナントの代表スタッフ（get_trainer_ids はテナント横断のため使わない）。
    // gymName はメールの差出人名に使う（渡さないと製品名にフォールバックしてしまう）。
    // 予約ごとに引き直す必要は無いので、ループの外で1回だけ取る。
    const [trainerId, gymName] = await Promise.all([
      fetchMyTenantTrainerId(),
      fetchMyTenantGymName(),
    ]);

    if (!trainerId) console.warn("No trainer found for booking notification");

    const bookingTime = `${startTime}〜${endTime}`;

    for (const booking of bookings) {
      // 予約日はJSTの暦日。date-fns の format をそのまま使うと端末のタイムゾーンで
      // 描画されるため、JSTより後ろの地域（海外にいるお客様など）では前日の日付で
      // メールが届いてしまう。JST固定の formatJST を通す。
      const formattedDate = formatJST(`${booking.date}T00:00:00+09:00`, "M月d日（E）", { locale: ja });

      // Notify trainer
      if (trainerId) {
        const result = await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "new-booking-notification",
            recipientEmail: "_resolve_trainer_",
            idempotencyKey: `booking-notify-${booking.id}`,
            templateData: {
              customerName,
              bookingDate: formattedDate,
              bookingTime,
              planName,
              gymName: gymName ?? undefined,
              // ネイティブアプリ内では window.location.origin が capacitor://localhost になり
              // メールのボタンが開けないため、共有リンクと同様に本番Webドメインへフォールバック
              dashboardUrl: getWebOrigin(),
              trainerUserId: trainerId,
            },
          },
        });
        logEmailInvoke("booking-create-trainer", "new-booking-notification", "_resolve_trainer_", result);
      }

      // Notify customer (booking confirmation email)
      if (customerUserId) {
        const customerRecipient = customerEmail || "_resolve_user_";
        const result = await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "booking-confirmation",
            recipientEmail: customerRecipient,
            idempotencyKey: `booking-confirm-customer-${booking.id}`,
            templateData: {
              customerName,
              bookingDate: formattedDate,
              bookingTime,
              planName,
              gymName: gymName ?? undefined,
              resolveUserId: customerUserId,
            },
          },
        });
        logEmailInvoke("booking-create-customer", "booking-confirmation", customerRecipient, result);
      }
    }
  } catch (e) {
    console.error("Failed to send booking notification email:", e);
  }
};
