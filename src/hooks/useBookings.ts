import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toJSTDate, formatJST } from "@/lib/timezone";
import { getGymNameForUser } from "@/lib/tenantLookup";
import { WAITLIST_ENABLED } from "@/lib/featureFlags";
import { shouldRebaseCycleStart, getMonthlySessionCount } from "@/lib/courseProgress";

export interface BookingRow {
  id: string;
  user_id: string;
  booking_date: string;
  status: string;
  booking_type: string;
  created_at: string;
  display_name?: string;
}

// Feature flag: customer-side LINE notifications for booking creation/cancellation.
// Set to true to re-enable. Trainer notifications and reminder notifications are
// unaffected. Code is preserved (only the send is skipped) so it can be revived later.
const NOTIFY_CUSTOMER_LINE_ON_BOOKING = false;

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

export interface BookingWithTime {
  id: string;
  user_id: string;
  date: string;
  startTime: string;
  endTime: string;
  clientName: string;
  status: string;
  booking_type: string;
  isBlocked?: boolean;
}

function parseBooking(row: BookingRow): BookingWithTime {
  // booking_date is a UTC ISO; render it in JST wall-clock.
  const dt = toJSTDate(row.booking_date);
  const h = dt.getHours();
  const m = dt.getMinutes();
  const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const endMin = h * 60 + m + 60;
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  const date = format(dt, "yyyy-MM-dd");

  return {
    id: row.id,
    user_id: row.user_id,
    date,
    startTime,
    endTime,
    clientName: row.display_name || "不明",
    status: row.status,
    booking_type: row.booking_type,
  };
}

export const useMyBookings = () => {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<BookingWithTime[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBookings = useCallback(async () => {
    if (!user) {
      setBookings([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("bookings")
      .select("*")
      .eq("user_id", user.id)
      .order("booking_date", { ascending: true });

    if (data) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .maybeSingle();

      setBookings(data.map((r) => parseBooking({ ...r, display_name: profile?.display_name || "自分" })));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  return { bookings, loading, refetch: fetchBookings };
};

export const useAllBookings = () => {
  const [bookings, setBookings] = useState<BookingWithTime[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBookings = useCallback(async () => {
    setLoading(true);

    const [{ data: rows, error }, { data: trialRows }, { data: blockedRows }] = await Promise.all([
      supabase.from("bookings").select("*").order("booking_date", { ascending: true }),
      supabase.from("trial_bookings").select("*").order("booking_date", { ascending: true }),
      supabase.from("blocked_slots").select("*"),
    ]);

    if (error) {
      console.error("Failed to fetch bookings:", error);
      setBookings([]);
      setLoading(false);
      return;
    }

    const allRows = rows || [];

    const userIds = [...new Set(allRows.map((r) => r.user_id))];
    const nameMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      profiles?.forEach((p) => {
        nameMap[p.user_id] = p.display_name || "不明";
      });
    }

    const parsed: BookingWithTime[] = allRows.map((r) =>
      parseBooking({ ...r, display_name: nameMap[r.user_id] || "不明" })
    );

    // Merge trial bookings as BookingWithTime entries
    trialRows?.forEach((t) => {
      if (t.status === "キャンセル済み") return;
      const dt = toJSTDate(t.booking_date);
      const h = dt.getHours();
      const m = dt.getMinutes();
      const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const endMin = h * 60 + m + 60;
      const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
      parsed.push({
        id: t.id,
        user_id: "trial-guest",
        date: format(dt, "yyyy-MM-dd"),
        startTime,
        endTime,
        clientName: `🆕 ${t.guest_name}`,
        status: t.status,
        booking_type: t.booking_type,
      });
    });

    // Merge blocked slots
    blockedRows?.forEach((bs) => {
      const dt = toJSTDate(bs.blocked_date);
      const endDt = toJSTDate(bs.end_blocked_date);
      const h = dt.getHours();
      const m = dt.getMinutes();
      const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const eh = endDt.getHours();
      const em = endDt.getMinutes();
      const endTime = `${String(eh).padStart(2, "0")}:${String(em).padStart(2, "0")}`;
      parsed.push({
        id: bs.id,
        user_id: "blocked",
        date: format(dt, "yyyy-MM-dd"),
        startTime,
        endTime,
        clientName: bs.reason || "ブロック",
        status: "ブロック済み",
        booking_type: "ブロック",
        isBlocked: true,
      });
    });

    parsed.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    setBookings(parsed);
    setLoading(false);
  }, []);

  const removeBooking = useCallback((bookingId: string) => {
    setBookings((current) => current.filter((booking) => booking.id !== bookingId));
  }, []);

  useEffect(() => {
    void fetchBookings();
  }, [fetchBookings]);

  return { bookings, loading, refetch: fetchBookings, removeBooking };
};

export const checkSlotBlocked = (bookings: BookingWithTime[], date: string, startTime: string, endTimeOverride?: string): boolean => {
  const BUFFER_MINUTES = 15;
  const timeToMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const newMin = timeToMin(startTime);
  // Default booking footprint is 60 minutes plus the required 15-minute interval.
  // This symmetric 75-minute window prevents bookings from being placed too close
  // before or after an existing booking.
  const newEnd = endTimeOverride ? timeToMin(endTimeOverride) : newMin + 60 + BUFFER_MINUTES;

  return bookings.some((b) => {
    if (b.date !== date || b.status === "キャンセル済み") return false;
    const bMin = timeToMin(b.startTime);
    const bEnd = timeToMin(b.endTime) + (b.isBlocked ? 0 : BUFFER_MINUTES);
    return newMin < bEnd && bMin < newEnd;
  });
};

/**
 * 新しいルーティンの1回目の予約なら、起算日（profiles.cycle_start_date）を
 * その予約日に自動設定する。ジムの運用「期限は1回目のトレーニング日から」に合わせ、
 * 1回目の予約が入るまでは期限未確定（PlanUsageCard 側で非表示）にできる。
 * 発動条件の詳細は shouldRebaseCycleStart（courseProgress.ts）を参照。失敗しても予約は成立させる。
 */
async function rebaseCycleStartIfNeeded(userId: string, dateKey: string, excludeBookingId: string): Promise<void> {
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("plan, cycle_start_date, tenant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!prof?.plan) return;

    // プラン定義（回数上限・サイクル月数）。サブスク以外（回数券・期間）は購入日起算のため動かさない。
    let maxSessions: number | null = null;
    let cycleMonths: number | null = null;
    if (prof.tenant_id) {
      const { data: tp } = await supabase
        .from("tenant_plans")
        .select("plan_type, max_sessions, cycle_months")
        .eq("tenant_id", prof.tenant_id)
        .eq("plan_name", prof.plan)
        .maybeSingle();
      if (tp) {
        if (tp.plan_type && tp.plan_type !== "subscription") return;
        maxSessions = tp.max_sessions ?? null;
        cycleMonths = tp.cycle_months ?? null;
      } else {
        const n = getMonthlySessionCount(prof.plan);
        if (n === null) return; // プラン名から判定できない → 触らない
        maxSessions = n === -1 ? null : n;
      }
    }

    const { data: rows } = await supabase
      .from("bookings")
      .select("booking_date, status")
      .eq("user_id", userId)
      .neq("id", excludeBookingId);

    const ok = shouldRebaseCycleStart({
      cycleStartDate: prof.cycle_start_date,
      maxSessions,
      cycleMonths,
      bookingDateKey: dateKey,
      existingBookings: (rows ?? []).map((r) => ({ id: "", booking_date: r.booking_date, status: r.status })),
    });
    if (!ok) return;

    await supabase.from("profiles").update({ cycle_start_date: dateKey }).eq("user_id", userId);
    console.log(`[cycle] 起算日を1回目の予約日に自動設定: ${userId} -> ${dateKey}`);
  } catch (e) {
    console.warn("rebaseCycleStartIfNeeded failed:", e);
  }
}

export const createBooking = async (
  userId: string,
  date: string,
  startTime: string,
  bookingType: string = "通常",
  isProxyBooking = false,
) => {
  const bookingDate = `${date}T${startTime}:00+09:00`;
  const { fetchMyTenantId, withTenant } = await import("@/lib/tenantHelper");
  const tenantId = await fetchMyTenantId();
  const { data, error } = await supabase
    .from("bookings")
    .insert(withTenant({ user_id: userId, booking_date: bookingDate, booking_type: bookingType, source: "gymboard" }, tenantId) as any)
    .select()
    .single();

  if (!error && data) {
    // 新しいルーティンの1回目なら起算日を予約日に自動設定（期限＝1回目から1ヶ月）。
    // 後続処理（表示更新・定期予約の2回目以降）が新しい起算日を見られるよう await する。
    await rebaseCycleStartIfNeeded(userId, date, data.id);

    // Notify customer about their booking (gated by feature flag)
    if (NOTIFY_CUSTOMER_LINE_ON_BOOKING) {
      sendBookingConfirmationToCustomer(userId, date, startTime, bookingType, isProxyBooking).catch(console.error);
    }
    // Always notify trainer about new bookings (skip if trainer is the one booking for themselves)
    sendNewBookingLineToTrainer(userId, date, startTime, bookingType).catch(console.error);

    // Sync to Google Calendar (fire-and-forget)
    supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data: prof }) => {
        supabase.functions.invoke("google-calendar-sync", {
          body: {
            action: "create",
            booking_id: data.id,
            booking_date: data.booking_date,
            booking_type: bookingType,
            client_name: prof?.display_name || "顧客",
          },
        }).catch(console.error);
      });
  }

  return { data, error };
};

/**
 * 定期予約: 毎週同じ曜日・時刻で weeks 回分をまとめて作成する。
 * 各回は個別に作成し、満枠（DBトリガー check_booking_overlap による拒否）等で
 * 失敗した週はスキップして続行する。成功・スキップした日付を返す。
 * 通知（トレーナーLINE・Googleカレンダー同期）は createBooking 内で回ごとに行われる。
 */
export const createRecurringBookings = async (
  userId: string,
  firstDate: string, // yyyy-MM-dd（1回目の日付）
  startTime: string,
  bookingType: string,
  weeks: number,
  isProxyBooking = false,
): Promise<{ booked: { id: string; date: string }[]; skipped: string[] }> => {
  const booked: { id: string; date: string }[] = [];
  const skipped: string[] = [];
  const [y, mo, da] = firstDate.split("-").map(Number);
  for (let i = 0; i < weeks; i++) {
    // ローカル日付で +7日ずつ（時刻を持たない日付演算のためTZずれ無し）
    const d = new Date(y, mo - 1, da + i * 7);
    const dateKey = format(d, "yyyy-MM-dd");
    const { data, error } = await createBooking(userId, dateKey, startTime, bookingType, isProxyBooking);
    if (error || !data) {
      skipped.push(dateKey);
    } else {
      booked.push({ id: data.id, date: dateKey });
    }
  }
  return { booked, skipped };
};

async function sendBookingConfirmationToCustomer(
  userId: string,
  date: string,
  startTime: string,
  bookingType: string,
  isProxyBooking: boolean,
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  const name = profile?.display_name || "お客";

  const md = formatJST(`${date}T${startTime}:00+09:00`, "M/d", { locale: ja });
  const dow = formatJST(`${date}T${startTime}:00+09:00`, "E", { locale: ja });
  const hm = formatJST(`${date}T${startTime}:00+09:00`, "HH:mm", { locale: ja });

  const proxyNote = isProxyBooking ? "\n※トレーナーが代理で予約を登録しました。" : "";
  const gymName = await getGymNameForUser(userId);

  await supabase.functions.invoke("send-line-message", {
    body: {
      user_id: userId,
      message: `✅ 予約確定\n\n${md}（${dow}）${hm}\n\n${name}様、トレーニングのご予約が完了しました。${proxyNote}\n\nプラン：${bookingType}\n\n${gymName}`,
    },
  });
}

async function sendNewBookingLineToTrainer(
  userId: string,
  date: string,
  startTime: string,
  bookingType: string,
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  const customerName = profile?.display_name || "顧客";

  const { data: trainerIds } = await supabase.rpc("get_trainer_ids");
  const trainerId = trainerIds?.[0]?.user_id;
  if (!trainerId) return;

  const dateStr = formatJST(`${date}T${startTime}:00+09:00`, "M月d日（E） HH:mm", { locale: ja });
  const gymName = await getGymNameForUser(userId);

  await supabase.functions.invoke("send-line-message", {
    body: {
      user_id: trainerId,
      message: `📅 新規予約通知\n\n${dateStr}\n\n${customerName}様から予約が入りました。\n\nプラン：${bookingType}\n\n${gymName}`,
    },
  });
}

// Module-scope set tracking in-flight cancellation requests, keyed by booking id.
// Prevents duplicate LINE notifications from double-taps or StrictMode double-invocation.
const inFlightCancels = new Set<string>();

export const cancelBooking = async (bookingId: string, cancelledByTrainer = false) => {
  // In-flight guard: prevent duplicate cancel calls for the same booking from
  // sending duplicate LINE/email notifications when the user double-taps or
  // when React StrictMode runs effects twice.
  if (inFlightCancels.has(bookingId)) {
    console.warn("cancelBooking: 同じ予約のキャンセルが処理中のためスキップ", bookingId);
    return { error: null };
  }
  inFlightCancels.add(bookingId);
  try {
  // Fetch booking details before deleting
  const { data: booking, error: fetchError } = await supabase
    .from("bookings")
    .select("id, user_id, booking_date, booking_type, google_event_id, tenant_id")
    .eq("id", bookingId)
    .maybeSingle();

  if (fetchError || !booking) {
    console.error("cancelBooking: 予約情報の取得に失敗", fetchError, bookingId);
    return { error: fetchError ?? null };
  }

  // Delete linked Google Calendar event first when an event ID is saved.
  // Failure must not block the booking cancellation.
  if (booking?.google_event_id) {
    try {
      await supabase.functions.invoke("google-calendar-sync", {
        body: {
          action: "delete",
          booking_id: booking.id,
          google_event_id: booking.google_event_id,
        },
      });
    } catch (e) {
      console.error("Google Calendar event delete failed:", e);
    }
  }

  const { error } = await supabase
    .from("bookings")
    .delete()
    .eq("id", bookingId);

  if (!error && booking) {
    console.log("LINE通知送信開始", booking.id, { cancelledByTrainer });
    // Send LINE cancel notification (fire-and-forget)
    sendCancelLineNotification(booking, cancelledByTrainer).catch((e) =>
      console.error("sendCancelLineNotification failed:", e)
    );
    // Send email cancel notifications (fire-and-forget)
    sendCancelEmailNotification(booking, cancelledByTrainer).catch((e) =>
      console.error("sendCancelEmailNotification failed:", e)
    );
    // Send web push notifications (fire-and-forget)
    sendCancelPushNotification(booking, cancelledByTrainer).catch((e) =>
      console.error("sendCancelPushNotification failed:", e)
    );
    // キャンセル待ちへの空き通知（fire-and-forget）。
    // 受信者はサーバー側（send-push-notification の waitlist_slot_freed）で
    // booking_waitlist から解決する（RLSにより顧客からは他人の待機行を読めないため）。
    if (WAITLIST_ENABLED && booking.tenant_id) {
      supabase.functions.invoke("send-push-notification", {
        body: {
          purpose: "waitlist_slot_freed",
          tenant_id: booking.tenant_id,
          booking_date: booking.booking_date,
        },
      }).catch((e) => console.error("waitlist notify failed:", e));
    }
  } else if (error) {
    console.error("cancelBooking: 削除エラー", error);
  }

  return { error };
  } finally {
    inFlightCancels.delete(bookingId);
  }
};

async function sendCancelLineNotification(
  booking: { user_id: string; booking_date: string; booking_type: string },
  cancelledByTrainer: boolean,
) {
  const dateStr = formatJST(booking.booking_date, "M月d日（E） HH:mm", { locale: ja });
  const md = formatJST(booking.booking_date, "M/d", { locale: ja });
  const dow = formatJST(booking.booking_date, "E", { locale: ja });
  const hm = formatJST(booking.booking_date, "HH:mm", { locale: ja });

  // Always fetch customer name & trainer id (needed for both paths)
  const [{ data: profile }, { data: trainerIds }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", booking.user_id).maybeSingle(),
    supabase.rpc("get_trainer_ids"),
  ]);
  const customerName = profile?.display_name || "顧客";
  const trainerId = trainerIds?.[0]?.user_id;
  const gymName = await getGymNameForUser(booking.user_id);

  if (cancelledByTrainer) {
    // Notify customer (gated by feature flag)
    if (NOTIFY_CUSTOMER_LINE_ON_BOOKING) {
      console.log("LINE送信: 顧客へキャンセル通知", booking.user_id);
      const custRes = await supabase.functions.invoke("send-line-message", {
        body: {
          user_id: booking.user_id,
          message: `❌ キャンセル完了\n\n${md}（${dow}）${hm}\n\n${customerName}様、上記ご予約をキャンセルしました。\n\nプラン：${booking.booking_type}\n\n${gymName}`,
        },
      });
      console.log("LINE送信結果(顧客):", custRes);
    }

    // Notify trainer (self-confirmation)
    if (trainerId) {
      console.log("LINE送信: トレーナーへキャンセル確認通知", trainerId);
      const trRes = await supabase.functions.invoke("send-line-message", {
        body: {
          user_id: trainerId,
          message: `✅ キャンセル処理完了\n\n${dateStr}\n\n${customerName}様の予約をキャンセルしました。\n\nプラン：${booking.booking_type}\n\n${gymName}`,
        },
      });
      console.log("LINE送信結果(トレーナー):", trRes);
    }
  } else {
    // Customer cancelled → notify both
    if (trainerId) {
      console.log("LINE送信: トレーナーへキャンセル通知", trainerId);
      await supabase.functions.invoke("send-line-message", {
        body: {
          user_id: trainerId,
          message: `❌ 予約キャンセル通知\n\n${dateStr}\n\n${customerName}様がキャンセルしました。\n\nプラン：${booking.booking_type}\n\n${gymName}`,
        },
      });
    }

    // Notify customer (cancellation confirmation, gated by feature flag)
    if (NOTIFY_CUSTOMER_LINE_ON_BOOKING) {
      console.log("LINE送信: 顧客へキャンセル確認通知", booking.user_id);
      await supabase.functions.invoke("send-line-message", {
        body: {
          user_id: booking.user_id,
          message: `❌ キャンセル完了\n\n${md}（${dow}）${hm}\n\n${customerName}様、上記ご予約をキャンセルしました。\n\nプラン：${booking.booking_type}\n\n${gymName}`,
        },
      });
    }
  }
}

async function sendCancelEmailNotification(
  booking: { id: string; user_id: string; booking_date: string; booking_type: string },
  cancelledByTrainer: boolean,
) {
  const dt = toJSTDate(booking.booking_date);
  const formattedDate = format(dt, "M月d日（E）", { locale: ja });
  const h = dt.getHours();
  const m = dt.getMinutes();
  const startTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const endMin = h * 60 + m + 60;
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
  const bookingTime = `${startTime}〜${endTime}`;

  const [{ data: profile }, { data: trainerIds }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", booking.user_id).maybeSingle(),
    supabase.rpc("get_trainer_ids"),
  ]);
  const customerName = profile?.display_name || "お客様";
  const trainerId = trainerIds?.[0]?.user_id;

  // Email trainer
  if (trainerId) {
    supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "booking-cancellation",
        recipientEmail: "_resolve_trainer_",
        idempotencyKey: `cancel-trainer-${booking.id}`,
        templateData: {
          customerName,
          bookingDate: formattedDate,
          bookingTime,
          planName: booking.booking_type,
          recipientRole: "trainer",
          cancelledByTrainer,
          trainerUserId: trainerId,
        },
      },
    }).then((result) => logEmailInvoke("booking-cancel-trainer", "booking-cancellation", "_resolve_trainer_", result))
      .catch((e) => console.error("Cancel email (trainer) failed:", e));
  }

  // Email customer (resolve email from auth via edge function)
  supabase.functions.invoke("send-transactional-email", {
    body: {
      templateName: "booking-cancellation",
      recipientEmail: "_resolve_user_",
      idempotencyKey: `cancel-customer-${booking.id}`,
      templateData: {
        customerName,
        bookingDate: formattedDate,
        bookingTime,
        planName: booking.booking_type,
        recipientRole: "customer",
        cancelledByTrainer,
        resolveUserId: booking.user_id,
      },
    },
  }).then((result) => logEmailInvoke("booking-cancel-customer", "booking-cancellation", "_resolve_user_", result))
    .catch((e) => console.error("Cancel email (customer) failed:", e));
}

async function sendCancelPushNotification(
  booking: { user_id: string; booking_date: string },
  cancelledByTrainer: boolean,
) {
  try {
    const md = formatJST(booking.booking_date, "M月d日", { locale: ja });
    const hm = formatJST(booking.booking_date, "HH:mm", { locale: ja });

    const [{ data: profile }, { data: trainerIds }] = await Promise.all([
      supabase.from("profiles").select("display_name").eq("user_id", booking.user_id).maybeSingle(),
      supabase.rpc("get_trainer_ids"),
    ]);
    const customerName = profile?.display_name || "お客様";
    const trainers = (trainerIds ?? []).map((t: { user_id: string }) => t.user_id);

    // Always notify customer about their own cancellation (confirmation)
    await supabase.functions.invoke("send-push-notification", {
      body: {
        user_ids: [booking.user_id],
        title: "予約がキャンセルされました",
        body: `${md} ${hm} の予約をキャンセルしました`,
        url: "/",
        tag: `booking-cancel-${booking.user_id}-${booking.booking_date}`,
      },
    });

    // Notify trainers
    if (trainers.length > 0) {
      await supabase.functions.invoke("send-push-notification", {
        body: {
          user_ids: trainers,
          title: "予約キャンセル",
          body: `${customerName}さんが ${md} ${hm} の予約をキャンセルしました`,
          url: "/",
          tag: `booking-cancel-trainer-${booking.user_id}-${booking.booking_date}`,
        },
      });
    }
  } catch (e) {
    console.error("sendCancelPushNotification error:", e);
  }
}

