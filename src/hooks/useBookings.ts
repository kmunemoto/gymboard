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

// 同日キャンセルを「消化扱い」にしたときの status。物理削除の代わりにこの値へ
// UPDATE することで、既存の「status === 'キャンセル済み' を除外する」判定
// （courseProgress.ts / planUsage.ts の消化数カウント、リマインダー系Edge
// Functionの `status === '予約済み'` 厳密一致、カレンダー系の `!== 'キャンセル済み'`
// 表示）が無改修のまま意図通りに動く: 消化数には数えられ、来ないはずのリマインドは
// 飛ばず、トレーナーの予定表には枠として残る。詳細は mem/features/booking-cancellation.md 参照。
export const SAME_DAY_FORFEIT_STATUS = "同日キャンセル済み";

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

  // Realtime: 他画面（トレーナー側の操作等）による自分の予約の変更を反映する。
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`my-bookings-realtime-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings", filter: `user_id=eq.${user.id}` },
        () => fetchBookings(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchBookings]);

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
        // 予定表の表示ラベル。DBの booking_type 値（"初回無料体験"）は据え置きだが、
        // 「無料」はジムによるため、表示上は "体験予約" に統一する（体験行は user_id
        // === "trial-guest" で判定するため、この表示値変更はロジックに影響しない）。
        booking_type: "体験予約",
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

  // Realtime: 顧客側の自己キャンセル・自己予約など、この画面を開いたまま行われた
  // 他画面での変更を反映する（従来はマウント時の一度きりの取得のみで、
  // 開いたままだと同日キャンセル消化等の変更が反映されないままになっていた）。
  useEffect(() => {
    const channel = supabase
      .channel("trainer-all-bookings-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
        fetchBookings();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "trial_bookings" }, () => {
        fetchBookings();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "blocked_slots" }, () => {
        fetchBookings();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
      .select("plan, cycle_start_date, tenant_id, grace_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (!prof?.plan) return;

    // プラン定義（回数上限・サイクル月数・猶予日数）。サブスク以外（回数券・期間）は購入日起算のため動かさない。
    let maxSessions: number | null = null;
    let cycleMonths: number | null = null;
    let graceDays: number | null = null;
    if (prof.tenant_id) {
      const { data: tp } = await supabase
        .from("tenant_plans")
        .select("plan_type, max_sessions, cycle_months, grace_days")
        .eq("tenant_id", prof.tenant_id)
        .eq("plan_name", prof.plan)
        .maybeSingle();
      if (tp) {
        if (tp.plan_type && tp.plan_type !== "subscription") return;
        maxSessions = tp.max_sessions ?? null;
        cycleMonths = tp.cycle_months ?? null;
        // 猶予OFFのお客様（profiles.grace_enabled=false）には猶予を適用しない
        graceDays = (prof as any).grace_enabled === false ? 0 : tp.grace_days ?? null;
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
      graceDays,
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
  opts: { silent?: boolean } = {},
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

    // silent: 予約変更（reschedule）の内部呼び出し。通知は呼び出し側が「変更」1通にまとめる。
    if (!opts.silent) {
      // Notify customer about their booking (gated by feature flag)
      if (NOTIFY_CUSTOMER_LINE_ON_BOOKING) {
        sendBookingConfirmationToCustomer(userId, date, startTime, bookingType, isProxyBooking).catch(console.error);
      }
      // Always notify trainer about new bookings (skip if trainer is the one booking for themselves)
      sendNewBookingLineToTrainer(userId, date, startTime, bookingType).catch(console.error);
    }

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

/**
 * 予約の日時をワンタップで変更（リスケジュール）する。
 * RLS/DBトリガーの制約（顧客のUPDATEポリシー無し・重複防止トリガーがINSERT限定）を避けるため、
 * 「旧予約を静かに削除 → 新枠で作成」で実現する。旧枠を先に消すことで、同日近接時刻への移動
 * （旧枠の前後75分バッファとの自己重複）でも作成できる。新枠作成に失敗（他者が先約 等）した
 * 場合は旧予約を復元してエラーを返すため、予約が消えたままになることはない。
 * 通知はキャンセル/新規の二重送信を避け、トレーナーへ「変更」1通（LINE＋プッシュ）だけ送る。
 */
export const rescheduleBooking = async (
  bookingId: string,
  newDate: string,
  newStartTime: string,
  opts: { forfeitOld?: boolean } = {},
): Promise<{ data: { id: string } | null; error: unknown }> => {
  const { data: old, error: fetchError } = await supabase
    .from("bookings")
    .select("id, user_id, booking_date, booking_type, tenant_id, source")
    .eq("id", bookingId)
    .maybeSingle();
  if (fetchError || !old) return { data: null, error: fetchError ?? new Error("booking not found") };

  const newBookingDate = `${newDate}T${newStartTime}:00+09:00`;
  // booking_date は timestamptz（SELECT時はUTC表記）なので瞬時(getTime)で同一判定する
  if (new Date(old.booking_date).getTime() === new Date(newBookingDate).getTime()) {
    return { data: { id: old.id }, error: null }; // 変更なし
  }

  const oldDateKey = old.booking_date; // 通知・復元用に保持
  // 旧枠の JST 日付・時刻（UTC表記の文字列をそのまま切らず、JSTへ整形して取り出す）
  const oldJstDate = formatJST(oldDateKey, "yyyy-MM-dd");
  const oldJstTime = formatJST(oldDateKey, "HH:mm");

  // 当日予約の変更（ジムが同日キャンセル消化ONのとき）: 旧枠を「物理削除」せず
  // 1回消化(同日キャンセル済み)にして残し、新枠を作成する。＝当日キャンセルと同じ扱い。
  // 「変更」で当日消化を回避できないようにするための分岐。
  if (opts.forfeitOld) {
    // 1) 旧（当日）枠を消化（status更新で残す・通知は出さない・Googleカレンダー予定は削除）
    const { error: fErr } = await cancelBooking(bookingId, false, { silent: true, forfeit: true });
    if (fErr) return { data: null, error: fErr };
    // 2) 新枠で作成（別日なら重複判定は日付違いで対象外。満枠等は作成側が拒否）
    const { data: created, error: createError } = await createBooking(
      old.user_id, newDate, newStartTime, old.booking_type, false, { silent: true },
    );
    if (createError || !created) {
      // 失敗 → 旧枠の消化を取り消して元の予約に戻す（予約消失を防ぐ）
      await supabase.from("bookings").update({ status: "予約済み" }).eq("id", bookingId);
      return { data: null, error: createError ?? new Error("reschedule create failed") };
    }
    // 3) トレーナーへ「変更」通知（#131で堅牢化済み）。旧枠は予定表に「同日キャンセル済み」で残る。
    sendRescheduleToTrainer(old.user_id, oldDateKey, newDate, newStartTime, old.booking_type).catch((e) =>
      console.error("sendRescheduleToTrainer failed:", e),
    );
    return { data: { id: created.id }, error: null };
  }

  // 1) 旧予約を静かに削除（旧枠のGoogleカレンダー予定も削除。キャンセル通知は出さない）
  const { error: delError } = await cancelBooking(bookingId, false, { silent: true });
  if (delError) return { data: null, error: delError };

  // 2) 新枠で作成（重複防止トリガーで満枠を検証。通知は出さない）
  const { data: created, error: createError } = await createBooking(
    old.user_id, newDate, newStartTime, old.booking_type, false, { silent: true },
  );

  if (createError || !created) {
    // 失敗（満枠等）→ 旧予約を復元して予約消失を防ぐ
    await createBooking(old.user_id, oldJstDate, oldJstTime, old.booking_type, false, { silent: true })
      .catch((e) => console.error("reschedule rollback failed:", e));
    return { data: null, error: createError ?? new Error("reschedule create failed") };
  }

  // 3) トレーナーへ「変更」通知を1通だけ（LINE＋プッシュ、fire-and-forget）
  sendRescheduleToTrainer(old.user_id, oldDateKey, newDate, newStartTime, old.booking_type).catch((e) =>
    console.error("sendRescheduleToTrainer failed:", e),
  );

  return { data: { id: created.id }, error: null };
};

async function sendRescheduleToTrainer(
  userId: string,
  oldBookingDate: string, // ISO（旧日時）
  newDate: string,
  newStartTime: string,
  bookingType: string,
) {
  const [{ data: profile }, { data: trainerIds }] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
    supabase.rpc("get_trainer_ids"),
  ]);
  const customerName = profile?.display_name || "顧客";
  const trainers = (trainerIds ?? []).map((t: { user_id: string }) => t.user_id);

  // プッシュ通知を最優先で送る（トレーナー全員＋本人）。
  // LINE を使わないジムでもプッシュが確実に飛ぶよう、LINE 送信より先に・独立して発火する。
  // （以前は await の LINE 送信を待ってから、かつ先頭トレーナー1人だけに送っていたため、
  //  LINE 側の遅延やトレーナー取得の失敗でプッシュまで届かない可能性があった）
  const shortNew = formatJST(`${newDate}T${newStartTime}:00+09:00`, "M月d日 HH:mm", { locale: ja });
  const pushTargets = [...new Set([...trainers, userId])];
  supabase.functions.invoke("send-push-notification", {
    body: {
      user_ids: pushTargets,
      title: "予約日時の変更",
      body: `${customerName}様が予約を${shortNew}に変更しました`,
      url: "/",
      tag: `reschedule-${userId}-${newDate}`,
    },
  }).catch((e) => console.error("reschedule push failed:", e));

  // LINE（先頭トレーナー宛、fire-and-forget）。未連携なら送信側が無視する。
  const firstTrainer = trainers[0];
  if (firstTrainer) {
    const oldStr = formatJST(oldBookingDate, "M月d日（E） HH:mm", { locale: ja });
    const newStr = formatJST(`${newDate}T${newStartTime}:00+09:00`, "M月d日（E） HH:mm", { locale: ja });
    const gymName = await getGymNameForUser(userId);
    supabase.functions.invoke("send-line-message", {
      body: {
        user_id: firstTrainer,
        message: `🔄 予約変更通知\n\n${oldStr}\n　↓\n${newStr}\n\n${customerName}様が予約日時を変更しました。\n\nプラン：${bookingType}\n\n${gymName}`,
      },
    }).catch((e) => console.error("reschedule LINE failed:", e));
  }
}

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

export const cancelBooking = async (
  bookingId: string,
  cancelledByTrainer = false,
  opts: { silent?: boolean; forfeit?: boolean } = {},
) => {
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
  // Failure must not block the booking cancellation. Done even when forfeiting:
  // the customer isn't coming either way, so the trainer's external calendar
  // should not keep showing the event.
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

  // 消化扱い（同日キャンセルのペナルティ）: 物理削除せず status だけ更新して残す。
  // SAME_DAY_FORFEIT_STATUS の定義コメント参照（消化数カウント/リマインダー/
  // カレンダー表示が既存の status 判定のまま意図通りに動く）。
  const { error } = opts.forfeit
    ? await supabase.from("bookings").update({ status: SAME_DAY_FORFEIT_STATUS }).eq("id", bookingId)
    : await supabase.from("bookings").delete().eq("id", bookingId);

  if (!error && booking && opts.silent) {
    // 予約変更（reschedule）の内部呼び出し: 旧枠のGoogleカレンダー削除・行削除だけ行い、
    // キャンセル通知は送らない（呼び出し側が「変更」1通にまとめる）。空き枠通知も出さない。
  } else if (!error && booking) {
    console.log("LINE通知送信開始", booking.id, { cancelledByTrainer, forfeit: !!opts.forfeit });
    // Send LINE cancel notification (fire-and-forget)
    sendCancelLineNotification(booking, cancelledByTrainer, !!opts.forfeit).catch((e) =>
      console.error("sendCancelLineNotification failed:", e)
    );
    // Send email cancel notifications (fire-and-forget)
    sendCancelEmailNotification(booking, cancelledByTrainer, !!opts.forfeit).catch((e) =>
      console.error("sendCancelEmailNotification failed:", e)
    );
    // Send web push notifications (fire-and-forget)
    sendCancelPushNotification(booking, cancelledByTrainer, !!opts.forfeit).catch((e) =>
      console.error("sendCancelPushNotification failed:", e)
    );
    // キャンセル待ちへの空き通知（fire-and-forget）。消化扱いの場合はスキップ:
    // その枠はトレーナーの予定表上「同日キャンセル済み」として引き続き占有表示される
    // ため（checkSlotBlocked 等が status !== 'キャンセル済み' で判定）、
    // 「空きました」と案内すると実際には取れず矛盾する。
    // 受信者はサーバー側（send-push-notification の waitlist_slot_freed）で
    // booking_waitlist から解決する（RLSにより顧客からは他人の待機行を読めないため）。
    if (WAITLIST_ENABLED && booking.tenant_id && !opts.forfeit) {
      supabase.functions.invoke("send-push-notification", {
        body: {
          purpose: "waitlist_slot_freed",
          tenant_id: booking.tenant_id,
          booking_date: booking.booking_date,
        },
      }).catch((e) => console.error("waitlist notify failed:", e));
    }
  } else if (error) {
    console.error("cancelBooking: 更新/削除エラー", error);
  }

  return { error };
  } finally {
    inFlightCancels.delete(bookingId);
  }
};

async function sendCancelLineNotification(
  booking: { user_id: string; booking_date: string; booking_type: string },
  cancelledByTrainer: boolean,
  forfeit: boolean,
) {
  const dateStr = formatJST(booking.booking_date, "M月d日（E） HH:mm", { locale: ja });
  const md = formatJST(booking.booking_date, "M/d", { locale: ja });
  const dow = formatJST(booking.booking_date, "E", { locale: ja });
  const hm = formatJST(booking.booking_date, "HH:mm", { locale: ja });
  const forfeitNote = forfeit ? "\n\n※同日キャンセルのため、今回の予約は1回消化した扱いになります。" : "";

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
          message: `❌ キャンセル完了\n\n${md}（${dow}）${hm}\n\n${customerName}様、上記ご予約をキャンセルしました。\n\nプラン：${booking.booking_type}${forfeitNote}\n\n${gymName}`,
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
          message: `✅ キャンセル処理完了\n\n${dateStr}\n\n${customerName}様の予約をキャンセルしました。\n\nプラン：${booking.booking_type}${forfeitNote}\n\n${gymName}`,
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
          message: `❌ 予約キャンセル通知\n\n${dateStr}\n\n${customerName}様がキャンセルしました。\n\nプラン：${booking.booking_type}${forfeitNote}\n\n${gymName}`,
        },
      });
    }

    // Notify customer (cancellation confirmation, gated by feature flag)
    if (NOTIFY_CUSTOMER_LINE_ON_BOOKING) {
      console.log("LINE送信: 顧客へキャンセル確認通知", booking.user_id);
      await supabase.functions.invoke("send-line-message", {
        body: {
          user_id: booking.user_id,
          message: `❌ キャンセル完了\n\n${md}（${dow}）${hm}\n\n${customerName}様、上記ご予約をキャンセルしました。\n\nプラン：${booking.booking_type}${forfeitNote}\n\n${gymName}`,
        },
      });
    }
  }
}

async function sendCancelEmailNotification(
  booking: { id: string; user_id: string; booking_date: string; booking_type: string },
  cancelledByTrainer: boolean,
  forfeit: boolean,
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
          forfeit,
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
        forfeit,
        resolveUserId: booking.user_id,
      },
    },
  }).then((result) => logEmailInvoke("booking-cancel-customer", "booking-cancellation", "_resolve_user_", result))
    .catch((e) => console.error("Cancel email (customer) failed:", e));
}

async function sendCancelPushNotification(
  booking: { user_id: string; booking_date: string },
  cancelledByTrainer: boolean,
  forfeit: boolean,
) {
  try {
    const md = formatJST(booking.booking_date, "M月d日", { locale: ja });
    const hm = formatJST(booking.booking_date, "HH:mm", { locale: ja });
    const forfeitSuffix = forfeit ? "（1回消化扱い）" : "";

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
        body: `${md} ${hm} の予約をキャンセルしました${forfeitSuffix}`,
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
          body: `${customerName}さんが ${md} ${hm} の予約をキャンセルしました${forfeitSuffix}`,
          url: "/",
          tag: `booking-cancel-trainer-${booking.user_id}-${booking.booking_date}`,
        },
      });
    }
  } catch (e) {
    console.error("sendCancelPushNotification error:", e);
  }
}

