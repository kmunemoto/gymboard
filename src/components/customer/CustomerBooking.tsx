import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Clock, Check, Trash2, CalendarPlus, Swords, Info, Repeat, CalendarClock, X, Phone, MessageCircle, MessageSquare } from "lucide-react";
import { openExternalUrl } from "@/lib/nativeBridge";
import { buildGoogleCalendarUrl } from "@/lib/googleCalendar";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyBookings, createBooking, createRecurringBookings, cancelBooking, rescheduleBooking, BookingWithTime, SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { format, addMonths, startOfDay } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { trialLabel } from "@/lib/dummyData";
import { sendBookingNotification } from "@/lib/bookingNotification";
import BookingCompleteDialog from "./BookingCompleteDialog";
import BookingCancelledDialog from "./BookingCancelledDialog";
import { getJSTNow, getJSTToday, toJSTDate, formatJST } from "@/lib/timezone";
import { maxRepeatWeeksFor } from "@/lib/repeatBookingWindow";
import { getBookingProgressIndex, resolveCycleMonths, resolveGraceDays, type BookingForProgress } from "@/lib/courseProgress";
import PlanUsageCard from "./PlanUsageCard";
import { formatDate } from "@/lib/dateFormat";
import { useWaitlist } from "@/hooks/useWaitlist";
import { WAITLIST_ENABLED } from "@/lib/featureFlags";
import CourseProgressBadge from "@/components/trainer/CourseProgressBadge";
import { useTenant } from "@/hooks/useTenant";
import { useTranslation } from "react-i18next";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

// セッション長・バッファはどちらもジムごとに変更可能（tenants.slot_duration_minutes /
// tenants.booking_buffer_minutes）。未設定/未ロード時のみこの既定値を使う。
const DEFAULT_BOOKING_BUFFER_MINUTES = 15;

const CustomerBooking = ({ onOpenChat }: { onOpenChat?: () => void }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile, loading: profileLoading, refetch: refetchProfile } = useProfile();
  const { bookings: myBookings, loading: bookingsLoading, refetch } = useMyBookings();
  const { tenant, plans: tenantPlans } = useTenant();

  // Build plan name → label / max sessions maps from tenant_plans
  const planLabelMap = useMemo(() => {
    // キー（予約種別の内部値）は "初回無料体験" のまま、表示ラベルだけ "体験予約" にする
    const m: Record<string, string> = { "初回無料体験": "体験予約" };
    tenantPlans?.forEach((p) => { m[p.plan_name] = p.plan_name; });
    return m;
  }, [tenantPlans]);

  // Tenant operating hours and slot duration (with sensible fallbacks)
  const parseHour = (t?: string) => {
    if (!t) return null;
    const [h] = t.split(":").map(Number);
    return Number.isFinite(h) ? h : null;
  };
  const openHour = parseHour(tenant?.operating_hours?.start) ?? 10;
  const closeHour = parseHour(tenant?.operating_hours?.end) ?? 21;
  const slotMinutes = tenant?.slot_duration_minutes ?? 60;

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BookingWithTime | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // 同日キャンセルのペナルティが有効な対象を「キャンセルする」で即キャンセルせず、
  // 一度警告表示に留めるための2段階確認フラグ（handleCancel参照）
  const [forfeitPending, setForfeitPending] = useState(false);
  const [lastBooked, setLastBooked] = useState<BookingWithTime | null>(null);
  const [lastCancelled, setLastCancelled] = useState<BookingWithTime | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 定期予約: 毎週同じ曜日・時間で何回分まとめて予約するか（1=この回のみ）
  const [repeatWeeks, setRepeatWeeks] = useState(1);
  // 予約の日時変更（リスケジュール）モード: 対象の既存予約（null=通常の新規予約モード）
  const [rescheduleTarget, setRescheduleTarget] = useState<BookingWithTime | null>(null);
  // 当日予約の変更を「変更する」で即実行せず、一度警告表示に留めるための2段階確認フラグ
  const [rescheduleForfeitPending, setRescheduleForfeitPending] = useState(false);
  // キャンセル待ちの登録/解除も、タップで即実行せず一度確認を挟む
  // （満枠グリッドの見た目は通常の「満枠」のままにして見づらさを避けつつ、誤操作も防ぐ）
  const [waitlistTarget, setWaitlistTarget] = useState<{ time: string; alreadyOn: boolean } | null>(null);
  const [waitlistSaving, setWaitlistSaving] = useState(false);

  // Booked slots fetched via SECURITY DEFINER RPC — sees ALL bookings regardless of RLS
  const [bookedSlots, setBookedSlots] = useState<{ date: string; startTime: string; endTime: string; isBlock: boolean }[]>([]);

  // Active raid boss periods (not defeated). Map of yyyy-MM-dd → { isStart, isEnd }
  const [raidDates, setRaidDates] = useState<Map<string, { isStart: boolean; isEnd: boolean }>>(new Map());

  useEffect(() => {
    supabase
      .from("raid_bosses")
      .select("start_date, end_date, defeated")
      .eq("defeated", false)
      .then(({ data }) => {
        if (!data) return;
        const m = new Map<string, { isStart: boolean; isEnd: boolean }>();
        data.forEach((r: { start_date: string; end_date: string }) => {
          const start = new Date(`${r.start_date}T00:00:00+09:00`);
          const end = new Date(`${r.end_date}T00:00:00+09:00`);
          for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
            const key = format(d, "yyyy-MM-dd");
            m.set(key, {
              isStart: key === r.start_date,
              isEnd: key === r.end_date,
            });
          }
        });
        setRaidDates(m);
      });
  }, []);

  // Set of dates (yyyy-MM-dd) where this customer has future bookings — for calendar dots
  const { futureDateSet, pastDateSet } = useMemo(() => {
    const today = getJSTToday();
    const future = new Set<string>();
    const past = new Set<string>();
    myBookings.forEach((b) => {
      // 同日キャンセル消化は「来ない予約」なのでカレンダーの丸印には出さない
      if (b.status === "キャンセル済み" || b.status === SAME_DAY_FORFEIT_STATUS) return;
      if (b.date >= today) future.add(b.date);
      else past.add(b.date);
    });
    return { futureDateSet: future, pastDateSet: past };
  }, [myBookings]);

  // selectedDate comes from <Calendar>, where the user's tap maps to a JST
  // calendar day; format() reads its local fields, which match.
  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";

  const fetchBookedSlots = useCallback(async (dateStr: string) => {
    // 自テナントの埋まり枠だけを取得する。旧 get_booked_slots(check_date) は
    // 全テナント横断で他ジムの予約まで返すため、混雑日は全枠が「満枠」に見えてしまう
    // （実際は自ジムに空きがある）。公開の体験予約ページと同じ、テナント絞り込みの
    // get_tenant_booked_slots を使う。
    if (!tenant?.id) { setBookedSlots([]); return; }
    const { data } = await supabase.rpc("get_tenant_booked_slots" as any, {
      p_tenant_id: tenant.id,
      from_date: dateStr,
      to_date: dateStr,
    });
    if (!data) { setBookedSlots([]); return; }
    // ここは意図的に SAME_DAY_FORFEIT_STATUS を除外しない: 同日キャンセル消化の枠は
    // 再販できない前提のため、カレンダー上は引き続き「埋まっている」枠として表示する
    // （checkSlotBlocked 等と同じ扱い。mem/features/booking-cancellation.md 参照）。
    const slots = (data as { booking_date: string; end_booking_date: string; status: string }[])
      .filter((r) => r.status !== "キャンセル済み")
      .map((r) => {
        const dt = toJSTDate(r.booking_date);
        const endDt = toJSTDate(r.end_booking_date);
        return {
          date: format(dt, "yyyy-MM-dd"),
          startTime: `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`,
          endTime: `${String(endDt.getHours()).padStart(2, "0")}:${String(endDt.getMinutes()).padStart(2, "0")}`,
          isBlock: r.status === "ブロック済み",
        };
      });
    setBookedSlots(slots);
  }, [tenant?.id]);

  useEffect(() => {
    if (dateKey) fetchBookedSlots(dateKey);
  }, [dateKey, fetchBookedSlots]);

  // Logged-in customers always use their contract plan from profiles.
  const customerPlan = profile?.plan || null;
  const selectedPlan = customerPlan;

  const bookingBufferMinutes = tenant?.booking_buffer_minutes ?? DEFAULT_BOOKING_BUFFER_MINUTES;

  const isSlotBlocked = (date: string, time: string): boolean => {
    const timeToMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const newMin = timeToMin(time);
    const newEnd = newMin + slotMinutes + bookingBufferMinutes;
    // Bookings occupy the gym's configured session length (既定60分) plus the gym's
    // configured buffer (既定15分). Apply the same footprint to both existing bookings
    // and the candidate so the buffer is enforced
    // before and after every booking.
    return bookedSlots.some((b) => {
      if (b.date !== date) return false;
      // 予約変更中は、変更対象（旧枠）を占有としてカウントしない。
      // これで同日の近い時刻（旧枠のバッファ内）にも移動できる（旧枠は削除して作り直すため）。
      if (rescheduleTarget && b.date === rescheduleTarget.date && b.startTime === rescheduleTarget.startTime) return false;
      const bMin = timeToMin(b.startTime);
      // get_tenant_booked_slots の end_booking_date は既に「開始+60分+ジムのバッファ分」
      // （tenants.booking_buffer_minutes、既定15分）で計算済み。ここで更に足すと
      // 二重計上で1枠ぶん余計に満枠化するため足さない
      // （公開の体験予約ページ TrialBooking.isSlotBlocked と同一ロジック）。
      const bEnd = timeToMin(b.endTime);
      return newMin < bEnd && bMin < newEnd;
    });
  };

  const isBookingDayClosed = (date: string): boolean => {
    // 予約日の0:00 JST を過ぎていたら締切
    const bookingDayStart = new Date(`${date}T00:00:00+09:00`).getTime();
    return Date.now() >= bookingDayStart;
  };

  // 過去日（今日より前）か。カレンダーで選択不可にする対象。
  const isPastDay = (date: string): boolean => !!date && date < getJSTToday();
  // 今日(JST)か。予約は不可だが「空き状況の閲覧のみ」可能にする対象。
  // 予約自体は generateSlots の tooSoon(=isBookingDayClosed) が引き続きブロックする。
  const isViewOnlyDay = (date: string): boolean => !!date && date === getJSTToday();

  const generateSlots = () => {
    const slots: { id: string; time: string; available: boolean; blocked: boolean; tooSoon: boolean }[] = [];
    const startMin = openHour * 60;
    // last bookable slot starts so the session ends by closing time
    const lastStart = closeHour * 60 - slotMinutes;
    for (let totalMin = startMin; totalMin <= lastStart; totalMin += 15) {
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const blocked = isSlotBlocked(dateKey, time);
      const tooSoon = isBookingDayClosed(dateKey);
      slots.push({ id: `${dateKey}-${time}`, time, available: !blocked && !tooSoon, blocked, tooSoon });
    }
    return slots;
  };

  const slots = dateKey ? generateSlots() : [];
  const { isOnWaitlist, toggle: toggleWaitlist, refresh: refreshWaitlist } = useWaitlist(dateKey || null);

  const handleWaitlistConfirm = async () => {
    if (!waitlistTarget || !dateKey) return;
    setWaitlistSaving(true);
    const result = await toggleWaitlist(dateKey, waitlistTarget.time);
    setWaitlistSaving(false);
    if (result === true) toast.success(t("booking.waitlistAdded"));
    else if (result === false) toast.success(t("booking.waitlistRemoved"));
    else toast.error(t("common.errorGeneric"));
    setWaitlistTarget(null);
  };

  const handleBook = async () => {
    if (submitting) return; // 二重送信ガード（ボタンのdisabledに加えた多重防御）
    if (!selectedDate || !selectedSlot || !user || !selectedPlan) return;
    const slot = slots.find((s) => s.id === selectedSlot);
    if (!slot) return;

    if (isBookingDayClosed(dateKey)) {
      toast.error(t("booking.errorAdvance"));
      setSelectedSlot(null);
      return;
    }

    if (isSlotBlocked(dateKey, slot.time)) {
      toast.error(t("booking.errorSlotTaken"));
      setSelectedSlot(null);
      return;
    }

    setSubmitting(true);

    // 定期予約: repeatWeeks > 1 なら毎週同じ曜日・時間でまとめて作成。
    // 満枠の週はスキップされる（結果はトーストで通知）。
    // 念のため、予約可能期間（1ヶ月先まで）を超える回数が紛れ込んでいないか送信直前にも
    // 絞り込む（UI側の自動絞り込みと合わせた二重防御。日付選択後に日をまたいだ等のケース向け）。
    const effectiveRepeatWeeks = Math.min(repeatWeeks, maxRepeatWeeksFor(selectedDate));
    let firstBooking: { id: string; date: string };
    if (effectiveRepeatWeeks > 1) {
      const { booked, skipped } = await createRecurringBookings(
        user.id, dateKey, slot.time, selectedPlan, effectiveRepeatWeeks,
      );
      if (booked.length === 0) {
        toast.error(t("booking.errorBookingFailed"));
        setSubmitting(false);
        return;
      }
      firstBooking = booked[0];
      toast.success(t("booking.repeatResult", { count: booked.length }));
      if (skipped.length > 0) {
        const dates = skipped
          .map((d) => formatJST(`${d}T00:00:00+09:00`, "M/d", { locale: ja }))
          .join("、");
        toast.info(t("booking.repeatSkipped", { count: skipped.length, dates }));
      }
    } else {
      const { data, error } = await createBooking(user.id, dateKey, slot.time, selectedPlan);
      if (error) {
        toast.error(t("booking.errorBookingFailed"));
        setSubmitting(false);
        return;
      }
      firstBooking = { id: data.id, date: dateKey };
    }

    const [h, m] = slot.time.split(":").map(Number);
    const endMin = h * 60 + m + slotMinutes;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    const newBooking: BookingWithTime = {
      id: firstBooking.id,
      user_id: user.id,
      date: firstBooking.date,
      startTime: slot.time,
      endTime,
      clientName: profile?.display_name || t("common.me"),
      status: "予約済み",
      booking_type: selectedPlan,
    };

    setLastBooked(newBooking);
    setSelectedSlot(null);
    setSelectedDate(undefined);
    setRepeatWeeks(1);
    // plan is auto-assigned, no need to reset
    setSubmitting(false);
    refetch();
    refetchProfile(); // 1回目の予約で起算日が自動設定された場合に利用期間カードを更新
    fetchBookedSlots(dateKey);

    // この枠のキャンセル待ちに入っていたら解除する（予約できたため不要）
    if (WAITLIST_ENABLED) {
      supabase
        .from("booking_waitlist" as any)
        .delete()
        .eq("user_id", user.id)
        .eq("booking_date", dateKey)
        .eq("start_time", slot.time)
        .then(() => refreshWaitlist());
    }

    // Fire-and-forget notification email to trainer
    sendBookingNotification(firstBooking.id, profile?.display_name || t("booking.customerFallback"), firstBooking.date, slot.time, endTime, selectedPlan, user.id, user.email);

    // Fire-and-forget LINE message to customer
    // Gated by feature flag — customer LINE booking notifications are currently disabled
    // (only the trainer reminder/notification flows remain). Set to true to revive.
    const NOTIFY_CUSTOMER_LINE_ON_BOOKING = false;
    if (NOTIFY_CUSTOMER_LINE_ON_BOOKING) {
      supabase.functions.invoke("send-line-message", {
        body: {
          user_id: user.id,
          message: `✅ 予約確定\n\n${format(selectedDate!, "M/d", { locale: ja })}（${format(selectedDate!, "E", { locale: ja })}）${slot.time}\n\n${profile?.display_name || "お客"}様、トレーニングのご予約が完了しました。\n\nプラン：${selectedPlan}\n\n${tenant?.gym_name || "ジムボード"}`,
        },
      }).catch((e) => console.error("LINE message failed:", e));
    }

    // Fire-and-forget push notification to trainer
    // 宛先は自テナントのスタッフのみ（get_trainer_ids は全テナント横断のため、
    // 別ジムのトレーナーに通知が飛ぶ/自ジムに届かない。チャット #141 と同じ対応）。
    import("@/lib/tenantHelper").then(async ({ fetchMyTenantStaffIds }) => {
      const staffIds = await fetchMyTenantStaffIds();
      if (staffIds.length === 0) return;
      supabase.functions.invoke("send-push-notification", {
        body: {
          user_ids: [...new Set([...staffIds, user.id])],
          title: "新しい予約",
          body: `${profile?.display_name || "お客様"}が${format(selectedDate!, "M月d日", { locale: ja })} ${slot.time}〜${endTime}を予約しました${repeatWeeks > 1 ? `（毎週同時刻×${repeatWeeks}回の定期予約）` : ""}`,
          url: "/",
          tag: `booking-${firstBooking.id}`,
        },
      }).catch((e) => console.error("Push notification failed:", e));
    }).catch((e) => console.error("Push notification failed:", e));

  };

  // 予約変更モードに入る: 対象を記録し、日付・スロット選択をリセットしてカレンダーへ誘導
  const startReschedule = (b: BookingWithTime) => {
    setRescheduleTarget(b);
    setSelectedDate(undefined);
    setSelectedSlot(null);
    setRepeatWeeks(1);
    setTimeout(() => document.getElementById("calendar-section")?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const cancelReschedule = () => {
    setRescheduleTarget(null);
    setRescheduleForfeitPending(false);
    setSelectedDate(undefined);
    setSelectedSlot(null);
  };

  // このテナントで同日キャンセル消化が有効、かつ「変更対象の予約」が今日(JST)の分か。
  // 当日の枠を手放す変更なので、当日キャンセルと同じく消化扱いにする。
  const rescheduleTargetForfeits = !!rescheduleTarget
    && !!tenant?.same_day_cancel_penalty_enabled
    && rescheduleTarget.date === getJSTToday();

  // 選択した新しい日時へ予約を変更する（旧枠削除→新枠作成、失敗時は旧枠復元）。
  // 当日の変更でジム設定ONのときは、旧枠を消化扱いにして残す（forfeitOld）。
  const handleReschedule = async () => {
    if (!rescheduleTarget || submitting) return;
    if (!selectedDate || !selectedSlot) return;
    const slot = slots.find((s) => s.id === selectedSlot);
    if (!slot) return;
    if (isBookingDayClosed(dateKey)) {
      toast.error(t("booking.errorAdvance"));
      setSelectedSlot(null);
      return;
    }
    if (isSlotBlocked(dateKey, slot.time)) {
      toast.error(t("booking.errorSlotTaken"));
      setSelectedSlot(null);
      return;
    }
    // 当日の予約変更（消化対象）は、最初の押下では警告表示に切り替えるだけに留める。
    if (rescheduleTargetForfeits && !rescheduleForfeitPending) {
      setRescheduleForfeitPending(true);
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await rescheduleBooking(rescheduleTarget.id, dateKey, slot.time, { forfeitOld: rescheduleTargetForfeits });
      if (error) {
        toast.error(t("booking.errorRescheduleFailed"));
        return;
      }
      toast.success(t("booking.rescheduleDone"));
      const oldKey = rescheduleTarget.date;
      setRescheduleTarget(null);
      setRescheduleForfeitPending(false);
      setSelectedDate(undefined);
      setSelectedSlot(null);
      refetch();
      refetchProfile();
      fetchBookedSlots(dateKey);
      if (oldKey && oldKey !== dateKey) fetchBookedSlots(oldKey);
    } finally {
      setSubmitting(false);
    }
  };

  // このテナントで同日キャンセルのペナルティが有効、かつ対象予約が今日(JST)の分か
  const cancelTargetForfeits = !!cancelTarget
    && !!tenant?.same_day_cancel_penalty_enabled
    && cancelTarget.date === getJSTToday();

  const handleCancel = async () => {
    if (!cancelTarget || cancelling) return;
    // 同日キャンセルのペナルティ対象は、最初の押下では警告表示に切り替えるだけに
    // 留め、実際のキャンセルは警告を見た上でのもう一度の確定操作で行う。
    if (cancelTargetForfeits && !forfeitPending) {
      setForfeitPending(true);
      return;
    }
    setCancelling(true);
    try {
      const { error } = await cancelBooking(cancelTarget.id, false, { forfeit: cancelTargetForfeits });
      if (error) {
        toast.error(t("booking.errorCancelFailed"));
        return;
      }
      const cancelled = cancelTarget;
      setCancelTarget(null);
      setForfeitPending(false);
      setLastCancelled(cancelled);
      refetch();
      if (dateKey) fetchBookedSlots(dateKey);
    } finally {
      setCancelling(false);
    }
  };

  const activeBookings = myBookings.filter((b) => {
    if (b.status === "キャンセル済み" || b.status === SAME_DAY_FORFEIT_STATUS) return false;
    const bookingDateTime = new Date(`${b.date}T${b.endTime}:00+09:00`);
    return bookingDateTime > new Date();
  });

  // 各予約の「今回 n/m 回目」算出用に BookingForProgress 形式へ変換
  // NOTE: hooks must run before any early return below to satisfy Rules of Hooks
  const bookingsForProgress: BookingForProgress[] = useMemo(
    () =>
      myBookings.map((b) => ({
        id: b.id,
        booking_date: `${b.date}T${b.startTime}:00+09:00`,
        status: b.status,
      })),
    [myBookings],
  );

  const cancelDescription = cancelTarget
    ? t("booking.cancelDescWithTime", { date: formatJST(`${cancelTarget.date}T00:00:00+09:00`, "M月d日（E）", { locale: ja }), startTime: cancelTarget.startTime, endTime: cancelTarget.endTime })
    : t("booking.cancelDescDefault");

  if (profileLoading || bookingsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  const planLabel = (type: string) => planLabelMap[type] || type;


  return (
    <>
      <div className="px-4 py-4 space-y-5 slide-up">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-accent" />
            {t("booking.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("booking.selectDateTimePrompt")}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">{t("booking.advanceNotice")}</p>
        </div>

        <PlanUsageCard
          planName={profile?.plan}
          cycleStartDate={profile?.cycle_start_date}
          tenantPlans={tenantPlans}
          bookings={myBookings.map((b) => ({ booking_date: `${b.date}T${b.startTime}:00+09:00`, status: b.status }))}
          graceEnabled={profile?.grace_enabled}
          showUsagePeriod={profile?.show_usage_period}
        />


        <Button
          type="button"
          onClick={() => document.getElementById("calendar-section")?.scrollIntoView({ behavior: "smooth" })}
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90 py-6 text-base rounded-xl shadow-md"
        >
          <CalendarPlus className="w-5 h-5" />
          {t("booking.newBooking")}
        </Button>

        {/* Existing bookings */}
        {activeBookings.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
              {t("booking.bookedCount", { count: activeBookings.length })}
            </h2>
            <div className="space-y-2">
              {[...activeBookings]
                .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
                .map((b) => (
                  <Card key={b.id} className="card-hover">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl accent-gradient flex items-center justify-center">
                          <CalendarDays className="w-4 h-4 text-accent-foreground" />
                        </div>
                        <div>
                          <p className="font-bold text-sm">
                            {formatJST(`${b.date}T00:00:00+09:00`, "M月d日（E）", { locale: ja })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {b.startTime}〜{b.endTime}
                          </p>
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                              {planLabel(b.booking_type)}
                            </Badge>
                            {(() => {
                              try {
                                const progress = getBookingProgressIndex(
                                  b.id,
                                  profile?.cycle_start_date,
                                  profile?.plan,
                                  bookingsForProgress,
                                  resolveCycleMonths(profile?.plan, tenantPlans),
                                  resolveGraceDays(profile?.plan, tenantPlans, profile?.grace_enabled),
                                );
                                if (!progress || progress.isUnconfigured) return null;
                                return (
                                  <CourseProgressBadge
                                    index={progress.index}
                                    total={progress.total}
                                    isUnlimited={progress.isUnlimited}
                                    isUnconfigured={progress.isUnconfigured}
                                    isOverflow={progress.isOverflow}
                                    isGraceCarryover={progress.isGraceCarryover}
                                  />
                                );
                              } catch (e) {
                                console.warn("[CustomerBooking] progress badge failed", e);
                                return null;
                              }
                            })()}

                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            window.open(buildGoogleCalendarUrl(b.date, b.startTime, b.endTime, planLabel(b.booking_type), tenant?.gym_name), "_blank");
                          }}
                          className="text-muted-foreground hover:text-accent transition-colors p-2"
                          title={t("booking.addToGoogleCalendar")}
                        >
                          <CalendarPlus className="w-4 h-4" />
                        </button>
                        {/* 日時変更（リスケジュール） */}
                        <button
                          type="button"
                          onClick={() => startReschedule(b)}
                          className="text-muted-foreground hover:text-accent transition-colors p-2"
                          title={t("booking.reschedule")}
                        >
                          <CalendarClock className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCancelTarget(b)}
                          className="text-destructive hover:text-destructive/80 transition-colors p-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </section>
        )}

        {/* No plan set → block booking */}
        {!selectedPlan && (
          <Card className="border-l-4 border-l-destructive bg-destructive/5 slide-up">
            <CardContent className="p-4 space-y-2">
              <p className="font-bold text-sm text-destructive">{t("booking.noPlanSet")}</p>
              <p className="text-xs text-muted-foreground">
                {t("booking.noPlanHelp")}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Date & time selection (plan auto-assigned) */}
        {selectedPlan && (
          <section id="calendar-section" className="slide-up scroll-mt-4">
            {/* 予約変更モードのバナー: どの予約を変更中かを明示し、やめる導線も出す */}
            {rescheduleTarget && (
              <div className="mb-3 p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">{t("booking.rescheduleModeTitle")}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {formatJST(`${rescheduleTarget.date}T00:00:00+09:00`, "M月d日（E）", { locale: ja })} {rescheduleTarget.startTime}〜 → {t("booking.rescheduleModeHint")}
                  </p>
                </div>
                <button type="button" onClick={cancelReschedule} className="text-muted-foreground hover:text-foreground shrink-0 p-1" title={t("common.cancel")}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {rescheduleTarget ? t("booking.selectNewDateTime") : t("booking.selectDateTime")}
                </h2>
              </div>
              <Badge variant="outline" className="text-xs shrink-0">
                {planLabel(selectedPlan)}
              </Badge>
            </div>

            <Card>
              <CardContent className="p-3 flex justify-center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(d) => {
                    if (d) {
                      const key = format(d, "yyyy-MM-dd");
                      const existing = myBookings.filter(
                        (b) => b.date === key && b.status !== "キャンセル済み" && b.status !== SAME_DAY_FORFEIT_STATUS
                      );
                      if (existing.length > 0) {
                        const times = existing
                          .map((b) => `${b.startTime}〜${b.endTime}`)
                          .join("、");
                        toast.info(t("booking.alreadyBookedThisDay", { times }));
                      }
                      // 定期予約の回数が、新しく選んだ日の予約可能期間（1ヶ月先まで）に
                      // 収まらなくなった場合は、選べる上限まで自動的に絞り込む。
                      const cap = maxRepeatWeeksFor(d);
                      if (repeatWeeks > cap) setRepeatWeeks(cap);
                    }
                    setSelectedDate(d);
                    setSelectedSlot(null);
                    if (d) {
                      setTimeout(() => {
                        document.getElementById("time-slots-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 100);
                    }
                  }}
                  locale={ja}
                  fromDate={startOfDay(getJSTNow())}
                  toDate={addMonths(startOfDay(getJSTNow()), 1)}
                  disabled={(date) => {
                    const yyyyMMdd = format(date, "yyyy-MM-dd");
                    // 当日は「空き状況の閲覧のみ」できるよう選択可能にする。予約可否は
                    // スロット側の tooSoon 判定（isBookingDayClosed）が引き続き当日を
                    // 予約不可にするため、ここで塞ぐのは過去日だけでよい。
                    return isPastDay(yyyyMMdd);
                  }}
                  className="pointer-events-auto"
                  components={{
                    DayContent: ({ date: dayDate }) => {
                      const key = format(dayDate, "yyyy-MM-dd");
                      const isFuture = futureDateSet.has(key);
                      const isPast = pastDateSet.has(key);
                      const raid = raidDates.get(key);
                      const dow = dayDate.getDay(); // 0=Sun..6=Sat
                      const roundLeft = raid && (raid.isStart || dow === 0);
                      const roundRight = raid && (raid.isEnd || dow === 6);
                      return (
                        <div className="relative flex flex-col items-center">
                          {raid && (
                            <span
                              aria-hidden
                              className="raid-band"
                              style={{
                                position: "absolute",
                                top: -2,
                                bottom: -2,
                                 left: roundLeft ? 0 : -4,
                                 right: roundRight ? 0 : -4,
                                 borderTopLeftRadius: roundLeft ? 8 : 0,
                                borderBottomLeftRadius: roundLeft ? 8 : 0,
                                borderTopRightRadius: roundRight ? 8 : 0,
                                borderBottomRightRadius: roundRight ? 8 : 0,
                                zIndex: 0,
                                pointerEvents: "none",
                              }}
                            />
                          )}
                          <span className="relative z-[1]">{dayDate.getDate()}</span>
                           {raid && (
                             <Swords
                               className="relative z-[1] raid-swords"
                               size={10}
                               color="#EF4444"
                               style={{ marginTop: -2 }}
                             />
                           )}
                          {(isFuture || isPast) && (
                            <span
                              className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full z-[1]"
                              style={{
                                width: 6,
                                height: 6,
                                backgroundColor: isFuture ? "#3FB6AC" : "#999",
                              }}
                            />
                          )}
                        </div>
                      );
                    },
                  }}
                />
              </CardContent>
            </Card>

            {selectedDate && (
              <div id="time-slots-section" className="mt-4 slide-up scroll-mt-4">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {t("booking.availableSlots", { date: formatDate(selectedDate, "monthDayDow") })}
                </h3>
                {isViewOnlyDay(dateKey) && (
                  <div className="mb-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
                    <div className="flex items-start gap-2">
                      <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      <p className="text-xs text-foreground leading-relaxed">
                        {t("booking.sameDayViewOnlyNotice")}
                      </p>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {tenant?.phone && (
                        <Button asChild variant="accent" size="sm" className="flex-1 min-w-[110px]">
                          {/* 番号は画面に出さず、tel: リンクで発信のみ行う */}
                          <a href={`tel:${tenant.phone}`}>
                            <Phone className="w-3.5 h-3.5 mr-1.5" />
                            {t("booking.callGym")}
                          </a>
                        </Button>
                      )}
                      {tenant?.line_url && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 min-w-[110px]"
                          onClick={() => tenant?.line_url && openExternalUrl(tenant.line_url)}
                        >
                          <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                          {t("common.lineContact")}
                        </Button>
                      )}
                      {onOpenChat && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 min-w-[110px]"
                          onClick={onOpenChat}
                        >
                          <MessageCircle className="w-3.5 h-3.5 mr-1.5" />
                          {t("booking.chatWithGym")}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-4 gap-1.5">
                  {slots.map((slot) => {
                    // 満枠（他予約で埋まっている＝blocked かつ 締切前）はキャンセル待ち登録可能（フラグON時のみ）。
                    const waitlistable = WAITLIST_ENABLED && !slot.available && slot.blocked && !slot.tooSoon;
                    const onWaitlist = waitlistable && isOnWaitlist(dateKey, slot.time);
                    // 当日など締切済みの日の「空いている枠」。予約は不可だが空き状況として区別表示する。
                    const viewOnlyOpen = slot.tooSoon && !slot.blocked;
                    return (
                    <button
                      key={slot.id}
                      type="button"
                      disabled={!slot.available && !waitlistable}
                      onClick={() => {
                        if (slot.available) {
                          setSelectedSlot(slot.id);
                          setTimeout(() => {
                            document.getElementById("booking-confirm-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }, 100);
                        } else if (waitlistable) {
                          setWaitlistTarget({ time: slot.time, alreadyOn: onWaitlist });
                        }
                      }}
                      className={`relative rounded-lg p-2 text-center text-xs font-semibold transition-all duration-200 min-h-[44px] ${
                        slot.available
                          ? selectedSlot === slot.id
                            ? "accent-gradient text-accent-foreground shadow-md scale-105"
                            : "bg-card border border-border hover:border-accent hover:shadow-sm"
                          : viewOnlyOpen
                            ? "bg-accent/10 border border-accent/40 text-foreground cursor-default"
                            : waitlistable
                              ? "bg-muted text-muted-foreground/60 hover:bg-muted/80"
                              : "bg-muted text-muted-foreground/40 cursor-not-allowed"
                      }`}
                    >
                      <span>{slot.time}</span>
                      {!slot.available && (
                        <span className="block text-[9px] font-medium">
                          {viewOnlyOpen
                            ? <span className="text-accent">{t("booking.slotOpen")}</span>
                            : <span className="text-destructive/70">{t("booking.slotFull")}</span>}
                        </span>
                      )}
                      {/* キャンセル待ち登録済みは満枠の見た目のまま、隅の小さいドットだけで示す
                          （文字ラベルを変えると満枠だらけのグリッドが「キャンセル待ち」で埋まって見づらくなるため） */}
                      {onWaitlist && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-warning" aria-hidden="true" />
                      )}
                      {selectedSlot === slot.id && (
                        <Check className="w-2.5 h-2.5 absolute top-0.5 right-0.5" />
                      )}
                    </button>
                    );
                  })}
                </div>

                {selectedSlot && (
                  <div id="booking-confirm-section" className="mt-3 p-3 rounded-xl bg-accent/10 border border-accent/20">
                    <p className="text-sm text-center mb-3">
                      <Badge variant="outline" className="mb-1.5">{planLabel(selectedPlan)}</Badge>
                      <br />
                      <span className="font-bold">{slots.find((s) => s.id === selectedSlot)?.time}</span>
                      〜
                      <span className="font-bold">
                        {(() => {
                          const t = slots.find((s) => s.id === selectedSlot)?.time;
                          if (!t) return "";
                          const [h, m] = t.split(":").map(Number);
                          const end = h * 60 + m + slotMinutes;
                          return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
                        })()}
                      </span>
                      （{t("booking.slotMinutes", { count: slotMinutes })}）
                    </p>
                    {/* 定期予約: 毎週同じ曜日・時間でまとめて予約（変更モードでは非表示） */}
                    {!rescheduleTarget && selectedDate && (() => {
                      // 選択中の日から、予約可能期間（1ヶ月先まで）に収まる回数の上限
                      const repeatCap = maxRepeatWeeksFor(selectedDate);
                      return (
                      <div className="mb-3 text-left">
                        <p className="text-[11px] font-bold text-muted-foreground mb-1.5 flex items-center gap-1">
                          <Repeat className="w-3 h-3" />
                          {t("booking.repeatTitle")}
                        </p>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[1, 2, 3, 4].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setRepeatWeeks(n)}
                              aria-pressed={repeatWeeks === n}
                              disabled={n > repeatCap}
                              className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                                n > repeatCap
                                  ? "bg-secondary/50 text-muted-foreground/40 cursor-not-allowed"
                                  : repeatWeeks === n
                                    ? "bg-accent text-accent-foreground shadow-sm"
                                    : "bg-secondary text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {n === 1 ? t("booking.repeatOnce") : t("booking.repeatTimes", { count: n })}
                            </button>
                          ))}
                        </div>
                        {repeatCap < 4 && (
                          <p className="text-[11px] text-muted-foreground mt-1.5">
                            {t("booking.repeatLimitedByWindow")}
                          </p>
                        )}
                        {repeatWeeks > 1 && (
                          <p className="text-[11px] text-muted-foreground mt-1.5">
                            {t("booking.repeatWeeklyDesc", { count: repeatWeeks })}
                          </p>
                        )}
                      </div>
                      );
                    })()}
                    <Button
                      variant="accent"
                      size="lg"
                      className="w-full"
                      onClick={rescheduleTarget ? handleReschedule : handleBook}
                      disabled={submitting}
                    >
                      {submitting ? (
                        <DumbbellLoader className="w-4 h-4 mr-2" />
                      ) : null}
                      {rescheduleTarget
                        ? t("booking.confirmReschedule")
                        : repeatWeeks > 1
                          ? t("booking.confirmRepeatBooking", { count: repeatWeeks })
                          : t("booking.confirmBooking")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {cancelTarget && (
        /* 暗幕は bg-foreground だと文字トーン反転(bg-tone-dark)で白幕に化けるため固定の黒系 */
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background glass p-6 shadow-lg">
            <div className="space-y-2 text-center sm:text-left">
              <h3 className="text-lg font-semibold">
                {forfeitPending ? t("booking.sameDayForfeitWarningTitle") : t("booking.cancelConfirmTitle")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {forfeitPending ? t("booking.sameDayForfeitWarningDesc") : cancelDescription}
              </p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2">
              <Button
                variant="outline"
                onClick={() => { setCancelTarget(null); setForfeitPending(false); }}
                disabled={cancelling}
              >
                {t("booking.back")}
              </Button>
              <Button
                onClick={handleCancel}
                disabled={cancelling}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {cancelling
                  ? t("booking.cancelling")
                  : forfeitPending
                    ? t("booking.sameDayForfeitConfirmBtn")
                    : t("booking.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {rescheduleForfeitPending && (
        /* 当日の予約変更（消化扱い）の確認ダイアログ。暗幕は cancelTarget と同様に固定の黒系。 */
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background glass p-6 shadow-lg">
            <div className="space-y-2 text-center sm:text-left">
              <h3 className="text-lg font-semibold">{t("booking.rescheduleForfeitWarningTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("booking.rescheduleForfeitWarningDesc")}</p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2">
              <Button
                variant="outline"
                onClick={() => setRescheduleForfeitPending(false)}
                disabled={submitting}
              >
                {t("booking.back")}
              </Button>
              <Button
                variant="accent"
                onClick={handleReschedule}
                disabled={submitting}
              >
                {submitting ? t("booking.rescheduling") : t("booking.rescheduleForfeitConfirmBtn")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {waitlistTarget && (
        /* キャンセル待ちの登録/解除の確認。暗幕は cancelTarget 等と同じ固定の黒系。 */
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background glass p-6 shadow-lg">
            <div className="space-y-2 text-center sm:text-left">
              <h3 className="text-lg font-semibold">
                {waitlistTarget.alreadyOn ? t("booking.waitlistLeaveTitle") : t("booking.waitlistJoinTitle")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {waitlistTarget.alreadyOn
                  ? t("booking.waitlistLeaveDesc", { time: waitlistTarget.time })
                  : t("booking.waitlistJoinDesc", { time: waitlistTarget.time })}
              </p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2">
              <Button
                variant="outline"
                onClick={() => setWaitlistTarget(null)}
                disabled={waitlistSaving}
              >
                {t("booking.back")}
              </Button>
              <Button
                onClick={handleWaitlistConfirm}
                disabled={waitlistSaving}
                variant={waitlistTarget.alreadyOn ? "outline" : "accent"}
                className={waitlistTarget.alreadyOn ? "text-destructive border-destructive/30 hover:bg-destructive/10" : undefined}
              >
                {waitlistSaving
                  ? t("common.saving")
                  : waitlistTarget.alreadyOn
                    ? t("booking.waitlistLeaveConfirmBtn")
                    : t("booking.waitlistJoinConfirmBtn")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <BookingCompleteDialog
        open={!!lastBooked}
        onClose={() => setLastBooked(null)}
        date={lastBooked?.date || ""}
        startTime={lastBooked?.startTime || ""}
        endTime={lastBooked?.endTime || ""}
        planName={lastBooked ? planLabel(lastBooked.booking_type) : ""}
        gymName={tenant?.gym_name}
      />

      <BookingCancelledDialog
        open={!!lastCancelled}
        onClose={() => setLastCancelled(null)}
        onNewBooking={() => {
          setLastCancelled(null);
          setTimeout(() => {
            document.getElementById("calendar-section")?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }}
        date={lastCancelled?.date || ""}
        startTime={lastCancelled?.startTime || ""}
        endTime={lastCancelled?.endTime || ""}
      />
    </>
  );
};

export default CustomerBooking;
