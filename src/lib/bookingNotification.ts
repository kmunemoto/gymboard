import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ja } from "date-fns/locale";

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
    // Find the trainer via secure RPC (avoids exposing user_roles table)
    const { data: trainerRoles } = await supabase.rpc("get_trainer_ids");
    const trainerRole = trainerRoles?.[0] ?? null;

    const dateObj = new Date(date + "T00:00:00+09:00");
    const formattedDate = format(dateObj, "M月d日（E）", { locale: ja });
    const bookingTime = `${startTime}〜${endTime}`;

    // Notify trainer
    if (trainerRole) {
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
            dashboardUrl: window.location.origin,
            trainerUserId: trainerRole.user_id,
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
