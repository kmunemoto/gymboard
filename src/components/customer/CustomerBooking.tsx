import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Clock, Check, Trash2, CalendarPlus, Loader2, Swords, CreditCard } from "lucide-react";
import { buildGoogleCalendarUrl } from "@/lib/googleCalendar";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyBookings, createBooking, cancelBooking, BookingWithTime } from "@/hooks/useBookings";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { format, addMonths, startOfDay, parseISO, differenceInDays } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { trialLabel } from "@/lib/dummyData";
import { sendBookingNotification } from "@/lib/bookingNotification";
import BookingCompleteDialog from "./BookingCompleteDialog";
import BookingCancelledDialog from "./BookingCancelledDialog";
import { getJSTNow, getJSTToday, toJSTDate, formatJST } from "@/lib/timezone";
import { getCycleWindow } from "@/lib/courseProgress";
import { useTenant } from "@/hooks/useTenant";
import { useTranslation } from "react-i18next";

const BOOKING_BUFFER_MINUTES = 15;

const CustomerBooking = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const { bookings: myBookings, loading: bookingsLoading, refetch } = useMyBookings();
  const { tenant, plans: tenantPlans } = useTenant();

  // Build plan name → label / max sessions maps from tenant_plans
  const planLabelMap = useMemo(() => {
    const m: Record<string, string> = { "初回無料体験": "初回無料体験" };
    tenantPlans?.forEach((p) => { m[p.plan_name] = p.plan_name; });
    return m;
  }, [tenantPlans]);
  const planMaxMap = useMemo(() => {
    const m: Record<string, number> = {};
    tenantPlans?.forEach((p) => { if (p.max_sessions != null) m[p.plan_name] = p.max_sessions; });
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
  const [lastBooked, setLastBooked] = useState<BookingWithTime | null>(null);
  const [lastCancelled, setLastCancelled] = useState<BookingWithTime | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      if (b.status === "キャンセル済み") return;
      if (b.date >= today) future.add(b.date);
      else past.add(b.date);
    });
    return { futureDateSet: future, pastDateSet: past };
  }, [myBookings]);

  // selectedDate comes from <Calendar>, where the user's tap maps to a JST
  // calendar day; format() reads its local fields, which match.
  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";

  const fetchBookedSlots = useCallback(async (dateStr: string) => {
    const { data } = await supabase.rpc("get_booked_slots", { check_date: dateStr });
    if (!data) { setBookedSlots([]); return; }
    const slots = data
      .filter((r: { status: string }) => r.status !== "キャンセル済み")
      .map((r: { booking_date: string; end_booking_date: string; status: string }) => {
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
  }, []);

  useEffect(() => {
    if (dateKey) fetchBookedSlots(dateKey);
  }, [dateKey, fetchBookedSlots]);

  // Logged-in customers always use their contract plan from profiles.
  const customerPlan = profile?.plan || null;
  const selectedPlan = customerPlan;

  const isSlotBlocked = (date: string, time: string): boolean => {
    const timeToMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const newMin = timeToMin(time);
    // NOTE: get_booked_slots RPC already returns end_booking_date = start + 75min
    // (60m session + 15m buffer baked in) for non-block bookings. Do NOT add the
    // buffer again here, otherwise customers see slots blocked 15 min later than
    // the trainer view. Blocked slots use their exact end_blocked_date.
    return bookedSlots.some((b) => {
      if (b.date !== date) return false;
      const bMin = timeToMin(b.startTime);
      const bEnd = timeToMin(b.endTime);
      return newMin < bEnd && bMin < newMin + 75;
    });
  };

  const isBookingDayClosed = (date: string): boolean => {
    // 予約日の0:00 JST を過ぎていたら締切
    const bookingDayStart = new Date(`${date}T00:00:00+09:00`).getTime();
    return Date.now() >= bookingDayStart;
  };

  const generateSlots = () => {
    const slots: { id: string; time: string; available: boolean }[] = [];
    const startMin = openHour * 60;
    // last bookable slot starts so the session ends by closing time
    const lastStart = closeHour * 60 - slotMinutes;
    for (let totalMin = startMin; totalMin <= lastStart; totalMin += 15) {
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const blocked = isSlotBlocked(dateKey, time);
      const tooSoon = isBookingDayClosed(dateKey);
      slots.push({ id: `${dateKey}-${time}`, time, available: !blocked && !tooSoon });
    }
    return slots;
  };

  const slots = dateKey ? generateSlots() : [];

  const handleBook = async () => {
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
    const { data, error } = await createBooking(user.id, dateKey, slot.time, selectedPlan);

    if (error) {
      toast.error(t("booking.errorBookingFailed"));
      setSubmitting(false);
      return;
    }

    const [h, m] = slot.time.split(":").map(Number);
    const endMin = h * 60 + m + slotMinutes;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    const newBooking: BookingWithTime = {
      id: data.id,
      user_id: user.id,
      date: dateKey,
      startTime: slot.time,
      endTime,
      clientName: profile?.display_name || t("common.me"),
      status: "予約済み",
      booking_type: selectedPlan,
    };

    setLastBooked(newBooking);
    setSelectedSlot(null);
    setSelectedDate(undefined);
    // plan is auto-assigned, no need to reset
    setSubmitting(false);
    refetch();
    fetchBookedSlots(dateKey);

    // Fire-and-forget notification email to trainer
    sendBookingNotification(data.id, profile?.display_name || "お客様", dateKey, slot.time, endTime, selectedPlan, user.id, user.email);

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
    supabase.rpc("get_trainer_ids").then(({ data: trainers }) => {
      if (trainers && trainers.length > 0) {
        const trainerIds = trainers.map((t) => t.user_id);
        supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: [...trainerIds, user.id],
            title: "📅 新しい予約",
            body: `${profile?.display_name || "お客様"}が${format(selectedDate!, "M月d日", { locale: ja })} ${slot.time}〜${endTime}を予約しました`,
            url: "/",
            tag: `booking-${data.id}`,
          },
        }).catch((e) => console.error("Push notification failed:", e));
      }
    });

  };

  const handleCancel = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const { error } = await cancelBooking(cancelTarget.id);
      if (error) {
        toast.error(t("booking.errorCancelFailed"));
        return;
      }
      const cancelled = cancelTarget;
      setCancelTarget(null);
      setLastCancelled(cancelled);
      refetch();
      if (dateKey) fetchBookedSlots(dateKey);
    } finally {
      setCancelling(false);
    }
  };

  const activeBookings = myBookings.filter((b) => {
    if (b.status === "キャンセル済み") return false;
    const bookingDateTime = new Date(`${b.date}T${b.endTime}:00+09:00`);
    return bookingDateTime > new Date();
  });

  const cancelDescription = cancelTarget
    ? `${formatJST(`${cancelTarget.date}T00:00:00+09:00`, "M月d日（E）", { locale: ja })} ${cancelTarget.startTime}〜${cancelTarget.endTime} の予約をキャンセルします。`
    : t("booking.cancelDescDefault");

  if (profileLoading || bookingsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  const planLabel = (type: string) => planLabelMap[type] || type;

  // Current cycle / plan summary (mirrors home screen logic)
  const currentPlan = profile?.plan;
  const hasPlan = !!currentPlan && currentPlan !== "初回無料体験";
  const now = getJSTNow();
  const currentCycle = hasPlan && profile?.cycle_start_date
    ? getCycleWindow(profile.cycle_start_date, now)
    : null;
  const remainingDays = currentCycle ? differenceInDays(currentCycle.end, now) : null;
  const cycleVisitedCount = currentCycle
    ? myBookings.filter((b) => {
        if (b.status === "キャンセル済み") return false;
        const d = parseISO(b.date);
        return d >= currentCycle.start && d < currentCycle.end;
      }).length
    : 0;
  const maxSessions = hasPlan ? (planMaxMap[currentPlan!] || 0) : 0;
  const isExpired = remainingDays !== null && remainingDays < 0;
  const isExpiringSoon = remainingDays !== null && remainingDays >= 0 && remainingDays <= 3;

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

        {hasPlan && (
          <Card className={`border-l-4 ${isExpired ? "border-l-destructive bg-destructive/5" : isExpiringSoon ? "border-l-warning bg-warning/5" : "border-l-accent bg-accent/5"}`}>
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-accent shrink-0" />
                <span className="text-sm font-bold">
                  {t("booking.currentPlan", { plan: planLabel(currentPlan!) })}
                </span>
              </div>
              {currentCycle && (
                <div className="flex items-center gap-2">
                  <Clock className={`w-4 h-4 shrink-0 ${isExpired ? "text-destructive" : isExpiringSoon ? "text-warning" : "text-accent"}`} />
                  <span className="text-xs text-muted-foreground">
                    利用期間：{format(currentCycle.start, "M/d", { locale: ja })}〜{format(currentCycle.end, "M/d", { locale: ja })}
                    {isExpired ? (
                      <span className="font-bold text-destructive ml-1">（期限切れ）</span>
                    ) : (
                      <span className={`font-bold ml-1 ${isExpiringSoon ? "text-warning" : "text-foreground"}`}>（残り{remainingDays}日）</span>
                    )}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Button
          type="button"
          onClick={() => document.getElementById("calendar-section")?.scrollIntoView({ behavior: "smooth" })}
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90 py-6 text-base rounded-xl shadow-md"
        >
          <CalendarPlus className="w-5 h-5" />
          新しい予約を取る
        </Button>

        {/* Existing bookings */}
        {activeBookings.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
              予約済み（{activeBookings.length}件）
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
                          <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 h-4">
                            {planLabel(b.booking_type)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            window.open(buildGoogleCalendarUrl(b.date, b.startTime, b.endTime, planLabel(b.booking_type), tenant?.gym_name), "_blank");
                          }}
                          className="text-muted-foreground hover:text-accent transition-colors p-2"
                          title="Googleカレンダーに追加"
                        >
                          <CalendarPlus className="w-4 h-4" />
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
              <p className="font-bold text-sm text-destructive">プランが設定されていません</p>
              <p className="text-xs text-muted-foreground">
                トレーナーにお問い合わせの上、プランを設定してもらってください。
              </p>
            </CardContent>
          </Card>
        )}

        {/* Date & time selection (plan auto-assigned) */}
        {selectedPlan && (
          <section id="calendar-section" className="slide-up scroll-mt-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1">
                <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  日時を選択
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
                        (b) => b.date === key && b.status !== "キャンセル済み"
                      );
                      if (existing.length > 0) {
                        const times = existing
                          .map((b) => `${b.startTime}〜${b.endTime}`)
                          .join("、");
                        toast.info(`この日は ${times} に予約済みです`);
                      }
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
                    // `date` is in browser local TZ; build the JST 20:15 instant
                    // for that calendar day using a JST-anchored ISO.
                    const yyyyMMdd = format(date, "yyyy-MM-dd");
                    const latestSlot = new Date(`${yyyyMMdd}T20:15:00+09:00`);
                    return latestSlot.getTime() - Date.now() < 24 * 60 * 60 * 1000;
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
                  {format(selectedDate, "M月d日（E）", { locale: ja })} の空き枠
                </h3>
                <div className="grid grid-cols-4 gap-1.5">
                  {slots.map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => {
                        setSelectedSlot(slot.id);
                        setTimeout(() => {
                          document.getElementById("booking-confirm-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }, 100);
                      }}
                      className={`relative rounded-lg p-2 text-center text-xs font-semibold transition-all duration-200 min-h-[44px] ${
                        !slot.available
                          ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                          : selectedSlot === slot.id
                            ? "accent-gradient text-accent-foreground shadow-md scale-105"
                            : "bg-card border border-border hover:border-accent hover:shadow-sm"
                      }`}
                    >
                      <span>{slot.time}</span>
                      {!slot.available && (
                        <span className="block text-[9px] text-destructive/70 font-medium">満枠</span>
                      )}
                      {selectedSlot === slot.id && (
                        <Check className="w-2.5 h-2.5 absolute top-0.5 right-0.5" />
                      )}
                    </button>
                  ))}
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
                      （{slotMinutes}分）
                    </p>
                    <Button variant="accent" size="lg" className="w-full" onClick={handleBook} disabled={submitting}>
                      {submitting ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : null}
                      この内容で予約する
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-lg">
            <div className="space-y-2 text-center sm:text-left">
              <h3 className="text-lg font-semibold">予約をキャンセルしますか？</h3>
              <p className="text-sm text-muted-foreground">{cancelDescription}</p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
                戻る
              </Button>
              <Button
                onClick={handleCancel}
                disabled={cancelling}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {cancelling ? "キャンセル中..." : "キャンセルする"}
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
