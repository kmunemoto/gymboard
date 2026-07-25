import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { getWebOrigin } from "@/lib/nativeBridge";
import { fetchMyTenantTrainerId, fetchMyTenantGymName } from "@/lib/tenantHelper";

const logEmailInvoke = (
  context: string,
  templateName: string,
  recipientEmail: string,
  result: Awaited<ReturnType<typeof supabase.functions.invoke>>,
) => {
  console.log("予約メール送信レスポンス", {
    context,
    templateName,
    recipientEmail,
    status: result.error ? "error" : "ok",
    body: result.data ?? result.error,
  });
};

/**
 * Send a booking notification email to the trainer.
 * Fire-and-forget — errors are logged but never block the UI.
 */
export const sendBookingNotification = async (
  bookingId: string,
  customerName: string,
  date: string,
  startTime: string,
  endTime: string,
  planName: string,
  customerUserId?: string,
  customerEmail?: string,
) => {
  try {
    // 宛先は自テナントの代表スタッフ（get_trainer_ids はテナント横断のため使わない）。
    // gymName はメールの差出人名に使う（渡さないと製品名にフォールバックしてしまう）。
    const [trainerId, gymName] = await Promise.all([
      fetchMyTenantTrainerId(),
      fetchMyTenantGymName(),
    ]);

    const dateObj = new Date(date + "T00:00:00+09:00");
    const formattedDate = format(dateObj, "M月d日（E）", { locale: ja });
    const bookingTime = `${startTime}〜${endTime}`;

    // Notify trainer
    if (trainerId) {
      const result = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "new-booking-notification",
          recipientEmail: "_resolve_trainer_",
          idempotencyKey: `booking-notify-${bookingId}`,
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
    } else {
      console.warn("No trainer found for booking notification");
    }

    // Notify customer (booking confirmation email)
    if (customerUserId) {
      const customerRecipient = customerEmail || "_resolve_user_";
      const result = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName: "booking-confirmation",
          recipientEmail: customerRecipient,
          idempotencyKey: `booking-confirm-customer-${bookingId}`,
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
  } catch (e) {
    console.error("Failed to send booking notification email:", e);
  }
};
