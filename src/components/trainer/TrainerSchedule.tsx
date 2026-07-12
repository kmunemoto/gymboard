import { useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Ban, Repeat } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAllBookings, checkSlotBlocked, createBooking, createRecurringBookings, cancelBooking, SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";
import { useAllCustomerProfiles } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/hooks/useTenant";
import { format, addDays, startOfWeek, isSameDay } from "date-fns";
import { ja } from "date-fns/locale";
import { formatDate } from "@/lib/dateFormat";
import { getJSTNow, getJSTToday, formatJST } from "@/lib/timezone";
import { toast } from "sonner";
import { sendBookingNotification } from "@/lib/bookingNotification";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import WeekTimelineView from "./WeekTimelineView";
import CourseProgressBadge from "./CourseProgressBadge";
import { getBookingProgressIndex, resolveCycleMonths, resolveGraceDays, type BookingForProgress } from "@/lib/courseProgress";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

const TrainerSchedule = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(getJSTNow(), { weekStartsOn: 1 }));
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week");
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const [proxyDate, setProxyDate] = useState<Date | undefined>();
  const [proxyTime, setProxyTime] = useState<string>("");
  const [proxyClient, setProxyClient] = useState<string>("");
  const [proxyBookingType, setProxyBookingType] = useState<string>("");
  // 定期予約: 毎週同じ曜日・時間で何回分まとめて予約するか（1=この回のみ）
  const [proxyRepeatWeeks, setProxyRepeatWeeks] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; clientName: string; date: string; startTime: string; isBlocked?: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 同日キャンセルのペナルティが有効なジムで、対象が当日の会員予約のときだけ
  // 「消化扱いにする」を選べるチェックボックスの値（既定ON）
  const [forfeitChecked, setForfeitChecked] = useState(true);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockDate, setBlockDate] = useState<Date | undefined>();
  const [blockStartTime, setBlockStartTime] = useState<string>("");
  const [blockEndTime, setBlockEndTime] = useState<string>("");

  const { bookings, loading, refetch, removeBooking } = useAllBookings();
  const { profiles } = useAllCustomerProfiles();
  const { tenant, plans } = useTenant();
  // 代理予約のプラン選択肢。プラン管理（tenant_plans）で作成したテナント固有プランを反映する。
  // アプリ登録済みのお客様は招待コードで入会済みのため、「初回無料体験」は予約種別として出さない。
  // プラン未割り当てのお客様向けに「プラン未設定」を既定の先頭選択肢として用意する。
  // tenant_plans 未取得時は従来の既定プランにフォールバックして空リストを避ける。
  const PROXY_NO_PLAN = "プラン未設定";
  const proxyPlanOptions = (() => {
    const tenantPlanNames = plans.map((p) => p.plan_name);
    const base = tenantPlanNames.length > 0 ? tenantPlanNames : ["月4回", "月6回", "月8回", "通い放題"];
    return [PROXY_NO_PLAN, ...base.filter((n) => n !== PROXY_NO_PLAN)];
  })();

  // user_id ごとの予約一覧（進捗計算用）
  const bookingsByUser = (() => {
    const map = new Map<string, BookingForProgress[]>();
    bookings
      .filter((b) => b.user_id !== "trial-guest" && b.user_id !== "blocked" && !b.isBlocked)
      .forEach((b) => {
        const rows = map.get(b.user_id) || [];
        rows.push({
          id: b.id,
          booking_date: `${b.date}T${b.startTime}:00+09:00`,
          status: b.status,
        });
        map.set(b.user_id, rows);
      });
    return map;
  })();

  const getProgress = (booking: { id: string; user_id: string; isBlocked?: boolean }) => {
    if (booking.isBlocked) return null;
    const profile = profiles.find((p) => p.user_id === booking.user_id);
    if (!profile) return null;
    return getBookingProgressIndex(
      booking.id,
      profile.cycle_start_date,
      profile.plan,
      bookingsByUser.get(booking.user_id) || [],
      resolveCycleMonths(profile.plan, plans),
      resolveGraceDays(profile.plan, plans, profile.grace_enabled),
    );
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const timeSlots = (() => {
    const slots: string[] = [];
    for (let min = 600; min <= 1335; min += 15) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
    return slots;
  })();

  const getSession = (day: Date, time: string) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return bookings.find((b) => b.date === dateStr && b.startTime === time && b.status !== "キャンセル済み");
  };

  const proxyDateKey = proxyDate ? format(proxyDate, "yyyy-MM-dd") : "";

  const handleProxyBook = async () => {
    if (!proxyDate || !proxyTime || !proxyClient || !proxyBookingType) {
      toast.error(t("schedule.errorSelectAll"));
      return;
    }
    if (checkSlotBlocked(bookings, proxyDateKey, proxyTime)) {
      toast.error(t("schedule.errorSlotTaken"));
      return;
    }

    setSubmitting(true);

    // 定期予約: proxyRepeatWeeks > 1 なら毎週同じ曜日・時間でまとめて作成。
    // 満枠の週はスキップされる（結果はトーストで通知）。
    let firstBooking: { id: string; date: string } | null = null;
    const client = profiles.find((p) => p.user_id === proxyClient);
    if (proxyRepeatWeeks > 1) {
      const { booked, skipped } = await createRecurringBookings(
        proxyClient, proxyDateKey, proxyTime, proxyBookingType, proxyRepeatWeeks, true,
      );
      if (booked.length === 0) {
        toast.error(t("schedule.errorAddFailed"));
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
      const { data: bookingData, error } = await createBooking(proxyClient, proxyDateKey, proxyTime, proxyBookingType, true);
      if (error) {
        toast.error(t("schedule.errorAddFailed"));
        setSubmitting(false);
        return;
      }
      firstBooking = bookingData?.id ? { id: bookingData.id, date: proxyDateKey } : null;
      toast.success(t("schedule.addedToast", { name: client?.display_name || t("schedule.clientFallback"), date: format(proxyDate, "M/d"), time: proxyTime }));
    }

    const [hh, mm] = proxyTime.split(":").map(Number);
    const endMin = hh * 60 + mm + 60;
    const proxyEndTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    setProxyDialogOpen(false);
    setProxyDate(undefined);
    setProxyTime("");
    setProxyClient("");
    setProxyBookingType("");
    setProxyRepeatWeeks(1);
    setSubmitting(false);
    void refetch();

    if (firstBooking?.id) {
      sendBookingNotification(firstBooking.id, client?.display_name || t("schedule.clientFallback"), firstBooking.date, proxyTime, proxyEndTime, proxyBookingType, proxyClient);
    }
  };

  // このテナントで同日キャンセルのペナルティが有効、かつ対象が今日(JST)の
  // 会員予約（ブロック枠・体験予約ではない）のときだけ、消化扱いを選択できる。
  const deleteTargetBookingRow = deleteTarget ? bookings.find((b) => b.id === deleteTarget.id) : undefined;
  const deleteTargetForfeitable = !!deleteTarget
    && !deleteTarget.isBlocked
    && deleteTargetBookingRow?.user_id !== "trial-guest"
    && !!tenant?.same_day_cancel_penalty_enabled
    && deleteTarget.date === getJSTToday();

  const handleDeleteBooking = async () => {
    if (!deleteTarget || deleting) return;

    const target = deleteTarget;
    setDeleting(true);

    // Blocked slot → delete from blocked_slots table
    if (target.isBlocked) {
      const { error } = await supabase.from("blocked_slots").delete().eq("id", target.id);
      if (error) {
        toast.error(t("schedule.releaseFailed"));
        setDeleting(false);
        return;
      }
      removeBooking(target.id);
      toast.success(t("schedule.releasedToast"));
      setDeleting(false);
      setDeleteTarget(null);
      return;
    }

    // Trial guest bookings are in trial_bookings table
    const booking = bookings.find((b) => b.id === target.id);
    let error: { code?: string; message?: string } | null | undefined;
    if (booking?.user_id === "trial-guest") {
      // Fetch google_event_id before cancelling (to delete the linked calendar event)
      const { data: trialData } = await supabase
        .from("trial_bookings")
        .select("google_event_id")
        .eq("id", target.id)
        .maybeSingle();

      // Delete linked Google Calendar event first. Failure must not block cancellation.
      if (trialData?.google_event_id) {
        try {
          await supabase.functions.invoke("google-calendar-sync", {
            body: {
              action: "delete",
              booking_id: target.id,
              google_event_id: trialData.google_event_id,
              is_trial: true,
            },
          });
        } catch (e) {
          console.error("Google Calendar trial event delete failed:", e);
        }
      }

      // 体験予約はソフトキャンセル(status更新)にする。
      // GymBoard の表示・重複判定はキャンセル済みを除外する(既存挙動を維持)。
      const res = await supabase
        .from("trial_bookings")
        .update({ status: "キャンセル済み" })
        .eq("id", target.id);
      error = res.error;
    } else {
      const res = await cancelBooking(target.id, true, { forfeit: deleteTargetForfeitable && forfeitChecked });
      error = res.error;
    }

    if (error) {
      console.error("Failed to delete booking:", error);
      const isPermissionError = error.code === "42501" || error.message?.includes("row-level security");
      toast.error(isPermissionError ? t("schedule.permissionDenied") : t("common.errorGeneric"));
      setDeleting(false);
      return;
    }

    removeBooking(target.id);
    toast.success(t("schedule.deletedToast"));
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleBlockSlot = async () => {
    if (!blockDate || !blockStartTime || !blockEndTime || !user) return;
    const dateStr = format(blockDate, "yyyy-MM-dd");

    if (blockEndTime <= blockStartTime) {
      toast.error(t("schedule.blockEndAfterStart"));
      return;
    }

    // Check if the range overlaps with any existing booking/block
    if (checkSlotBlocked(bookings, dateStr, blockStartTime, blockEndTime)) {
      toast.error(t("schedule.blockOverlap"));
      return;
    }

    setSubmitting(true);
    const { fetchMyTenantId, withTenant } = await import("@/lib/tenantHelper");
    const tenantId = await fetchMyTenantId();
    const row = {
      blocked_date: `${dateStr}T${blockStartTime}:00+09:00`,
      end_blocked_date: `${dateStr}T${blockEndTime}:00+09:00`,
      created_by: user.id,
      reason: t("schedule.blockReason", { start: blockStartTime, end: blockEndTime }),
    };

    const { error } = await supabase.from("blocked_slots").insert(withTenant(row, tenantId) as any);

    if (error) {
      toast.error(t("schedule.blockFailed"));
      setSubmitting(false);
      return;
    }

    toast.success(t("schedule.blockedToast", { date: format(blockDate, "M/d"), start: blockStartTime, end: blockEndTime }));
    setBlockDialogOpen(false);
    setBlockDate(undefined);
    setBlockStartTime("");
    setBlockEndTime("");
    setSubmitting(false);
    void refetch();
  };

  const getDayBookings = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return bookings.filter((b) => b.date === dateStr && b.status !== "キャンセル済み");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  return (
    <div className="pb-24 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-accent" />
          {t("schedule.title")}
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBlockDialogOpen(true)} className="gap-1.5">
            <Ban className="w-3.5 h-3.5" />
            {t("schedule.blockTime")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setProxyDialogOpen(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            {t("schedule.proxyBooking")}
          </Button>
        </div>
        <div className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[120px] text-center">
            {format(weekStart, "M/d", { locale: ja })} 〜 {format(addDays(weekStart, 6), "M/d", { locale: ja })}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-1 h-8 px-2 text-xs"
            onClick={() => setWeekStart(startOfWeek(getJSTNow(), { weekStartsOn: 1 }))}
          >
            {t("common.today")}
          </Button>
        </div>
      </div>

      {/* 表示モード切替 */}
      <div className="flex items-center gap-1 mb-3 p-1 bg-muted/40 rounded-lg w-fit">
        {([
          { key: "day", label: t("schedule.modeDay") },
          { key: "week", label: t("schedule.modeWeek") },
          { key: "month", label: t("schedule.modeMonth") },
        ] as const).map((m) => (
          <button
            key={m.key}
            type="button"
            disabled={m.key === "month"}
            onClick={() => setViewMode(m.key)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              viewMode === m.key
                ? "bg-accent text-accent-foreground shadow-sm"
                : m.key === "month"
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m.label}
            {m.key === "month" && <span className="ml-1 text-[9px]">{t("schedule.modeMonthSoon")}</span>}
          </button>
        ))}
      </div>

      {/* 週間タイムライン表示 */}
      {viewMode === "week" && (
        <WeekTimelineView
          weekStart={weekStart}
          bookings={bookings}
          tenantPlans={plans}
          profiles={profiles.map((p) => ({
            user_id: p.user_id,
            plan: p.plan ?? null,
            cycle_start_date: p.cycle_start_date ?? null,
          }))}
          onSelectBooking={(b) =>
            setDeleteTarget({
              id: b.id,
              clientName: b.clientName,
              date: b.date,
              startTime: b.startTime,
              isBlocked: b.isBlocked,
            })
          }
        />
      )}

      {viewMode === "day" && (
        <>
      <div className="hidden md:block">
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="p-3 text-xs font-bold text-muted-foreground w-16">{t("schedule.headerTime")}</th>
                    {weekDays.map((day) => {
                      const isToday = isSameDay(day, getJSTNow());
                      return (
                        <th key={day.toISOString()} className={`p-3 text-center ${isToday ? "bg-accent/10" : ""}`}>
                          <p className="text-[10px] text-muted-foreground font-semibold uppercase">
                            {format(day, "EEE", { locale: ja })}
                          </p>
                          <p className={`text-sm font-bold mt-0.5 ${isToday ? "text-accent" : ""}`}>
                            {format(day, "d")}
                          </p>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {timeSlots.map((time) => {
                    const hasAnySession = weekDays.some((day) => getSession(day, time));
                    if (!hasAnySession) return null;

                    return (
                      <tr key={time} className="border-b last:border-b-0">
                        <td className="p-2 text-xs font-medium text-muted-foreground text-center border-r">{time}</td>
                        {weekDays.map((day) => {
                          const session = getSession(day, time);
                          const isToday = isSameDay(day, getJSTNow());
                          return (
                            <td key={day.toISOString()} className={`p-1 ${isToday ? "bg-accent/5" : ""}`}>
                              {session && (
                                <div className={`rounded-lg p-2 pr-12 text-xs relative ${
                                  session.isBlocked
                                    ? "bg-muted border border-dashed border-destructive/30 text-muted-foreground"
                                    : session.status === SAME_DAY_FORFEIT_STATUS
                                      ? "bg-muted border border-border text-muted-foreground"
                                      : "accent-gradient text-accent-foreground"
                                }`}>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    aria-label={session.isBlocked ? t("schedule.blockedRelease") : t("schedule.deleteBookingAria", { name: session.clientName })}
                                    onClick={() => { setDeleteTarget({ id: session.id, clientName: session.clientName, date: session.date, startTime: session.startTime, isBlocked: session.isBlocked }); setForfeitChecked(true); }}
                                    className="absolute top-1 right-1 h-7 w-7 rounded-md"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                  <p className="font-bold truncate">{session.isBlocked ? t("schedule.blockedLabel") : session.clientName}</p>
                                  <p className="opacity-75 truncate">{session.startTime}〜{session.endTime}</p>
                                  {!session.isBlocked && session.status === SAME_DAY_FORFEIT_STATUS && (
                                    <p className="truncate text-[9px] mt-0.5 font-semibold">{t("schedule.sameDayForfeitBadge")}</p>
                                  )}
                                  {!session.isBlocked && <p className="opacity-60 truncate text-[9px] mt-0.5">{session.booking_type}</p>}
                                  {!session.isBlocked && (() => {
                                    const p = getProgress(session);
                                    if (!p) return null;
                                    return (
                                      <CourseProgressBadge
                                        index={p.index}
                                        total={p.total}
                                        isUnlimited={p.isUnlimited}
                                        isUnconfigured={p.isUnconfigured}
                                        isOverflow={p.isOverflow}
                                        isGraceCarryover={p.isGraceCarryover}
                                        className="mt-1"
                                      />
                                    );
                                  })()}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="md:hidden space-y-3">
        {weekDays.map((day) => {
          const isToday = isSameDay(day, getJSTNow());
          const dayBookings = getDayBookings(day);
          return (
            <div key={day.toISOString()}>
              <div className={`flex items-center gap-2 mb-1.5 ${isToday ? "text-accent" : "text-muted-foreground"}`}>
                <span className="text-xs font-bold uppercase">
                  {formatDate(day, "slashMonthDayDow")}
                </span>
                {isToday && <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded-full font-bold">{t("common.today")}</span>}
              </div>
              {dayBookings.length > 0 ? (
                <div className="space-y-1.5">
                  {dayBookings
                    .sort((a, b) => a.startTime.localeCompare(b.startTime))
                    .map((booking) => (
                      <Card key={booking.id} className={`card-hover ${booking.isBlocked ? "border-dashed border-destructive/30" : ""}`}>
                        <CardContent className="p-3">
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                              booking.isBlocked || booking.status === SAME_DAY_FORFEIT_STATUS
                                ? "bg-muted text-muted-foreground"
                                : "accent-gradient text-accent-foreground"
                            }`}>
                              {booking.isBlocked ? "—" : booking.clientName[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{booking.isBlocked ? t("schedule.blockedLabel") : booking.clientName}</p>
                              <p className="text-xs text-muted-foreground">{booking.startTime}〜{booking.endTime}</p>
                              {!booking.isBlocked && booking.status === SAME_DAY_FORFEIT_STATUS && (
                                <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">{t("schedule.sameDayForfeitBadge")}</p>
                              )}
                              {!booking.isBlocked && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{booking.booking_type}</p>}
                              {!booking.isBlocked && (() => {
                                const p = getProgress(booking);
                                if (!p) return null;
                                return (
                                  <CourseProgressBadge
                                    index={p.index}
                                    total={p.total}
                                    isUnlimited={p.isUnlimited}
                                    isUnconfigured={p.isUnconfigured}
                                    isOverflow={p.isOverflow}
                                    isGraceCarryover={p.isGraceCarryover}
                                    className="mt-1"
                                  />
                                );
                              })()}
                            </div>
                          </div>
                          <div className="mt-3 flex justify-end">
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => { setDeleteTarget({ id: booking.id, clientName: booking.clientName, date: booking.date, startTime: booking.startTime, isBlocked: booking.isBlocked }); setForfeitChecked(true); }}
                              className="min-w-[112px]"
                            >
                              <Trash2 className="w-4 h-4" />
                              {booking.isBlocked ? t("schedule.release") : t("common.delete")}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pl-1 mb-1">{t("schedule.noBookings")}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded accent-gradient" />
          <span className="text-xs text-muted-foreground">{t("schedule.legendBooked")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded border border-dashed border-destructive/30 bg-muted" />
          <span className="text-xs text-muted-foreground">{t("schedule.legendBlocked")}</span>
        </div>
      </div>
        </>
      )}

      {viewMode === "month" && (
        <div className="border rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">
          {t("schedule.monthSoon")}
        </div>
      )}

      <Dialog open={proxyDialogOpen} onOpenChange={setProxyDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("schedule.proxyDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("schedule.labelClient")}</label>
              <select
                value={proxyClient}
                onChange={(e) => {
                  const selectedUserId = e.target.value;
                  setProxyClient(selectedUserId);
                  const selectedProfile = profiles.find((p) => p.user_id === selectedUserId);
                  // お客様に割り当て済みのプランを初期選択。未設定や選択肢に無いプランは「プラン未設定」にフォールバック。
                  const assignedPlan = selectedProfile?.plan;
                  setProxyBookingType(
                    assignedPlan && proxyPlanOptions.includes(assignedPlan) ? assignedPlan : PROXY_NO_PLAN,
                  );
                }}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="" disabled>{t("schedule.selectPrompt")}</option>
                {profiles.map((p) => (
                  <option key={p.user_id} value={p.user_id}>{p.display_name || t("common.unknown")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("schedule.labelPlan")}</label>
              <select
                value={proxyBookingType}
                onChange={(e) => setProxyBookingType(e.target.value)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="" disabled>{t("schedule.selectPrompt")}</option>
                {proxyPlanOptions.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("schedule.labelDate")}</label>
              <Calendar
                mode="single"
                selected={proxyDate}
                onSelect={(d) => {
                  setProxyDate(d);
                  setProxyTime("");
                  if (d) {
                    setTimeout(() => {
                      document.getElementById("proxy-time-slots-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 100);
                  }
                }}
                locale={ja}
                className="pointer-events-auto border rounded-lg mx-auto"
              />
            </div>
            {proxyDate && (
              <div id="proxy-time-slots-section" className="scroll-mt-4">
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("schedule.labelStartTime")}</label>
                <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                  {(() => {
                    const slots: { time: string; blocked: boolean }[] = [];
                    for (let totalMin = 600; totalMin <= 1260; totalMin += 15) {
                      const h = Math.floor(totalMin / 60);
                      const m = totalMin % 60;
                      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                      const blocked = checkSlotBlocked(bookings, proxyDateKey, time, undefined);
                      slots.push({ time, blocked });
                    }
                    return slots.map((slot) => (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={slot.blocked}
                        onClick={() => setProxyTime(slot.time)}
                        className={`rounded-lg p-2.5 text-xs font-semibold transition-all min-h-[44px] ${
                          slot.blocked
                            ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                            : proxyTime === slot.time
                              ? "accent-gradient text-accent-foreground shadow-md"
                              : "bg-card border border-border hover:border-accent"
                        }`}
                      >
                        {slot.time}
                        {slot.blocked && <span className="block text-[9px] text-destructive/70">{t("schedule.slotFull")}</span>}
                      </button>
                    ));
                  })()}
                </div>
              </div>
            )}
            {/* 定期予約: 毎週同じ曜日・時間でまとめて予約 */}
            {proxyDate && proxyTime && (
              <div>
                <p className="text-[11px] font-bold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Repeat className="w-3 h-3" />
                  {t("booking.repeatTitle")}
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setProxyRepeatWeeks(n)}
                      aria-pressed={proxyRepeatWeeks === n}
                      className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                        proxyRepeatWeeks === n
                          ? "bg-accent text-accent-foreground shadow-sm"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {n === 1 ? t("booking.repeatOnce") : t("booking.repeatTimes", { count: n })}
                    </button>
                  ))}
                </div>
                {proxyRepeatWeeks > 1 && (
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {t("booking.repeatWeeklyDesc", { count: proxyRepeatWeeks })}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setProxyDialogOpen(false)} className="w-full sm:w-auto">{t("common.cancel")}</Button>
            <Button variant="accent" onClick={handleProxyBook} disabled={!proxyDate || !proxyTime || !proxyClient || submitting} className="w-full sm:w-auto">
              {submitting && <DumbbellLoader className="w-4 h-4 mr-1" />}
              {proxyRepeatWeeks > 1 ? t("booking.confirmRepeatBooking", { count: proxyRepeatWeeks }) : t("schedule.bookNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deleteTarget?.isBlocked ? t("schedule.releaseTitle") : t("schedule.deleteTitle")}</DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              {deleteTarget?.isBlocked
                ? t("schedule.releaseDesc", { date: deleteTarget.date, time: deleteTarget.startTime })
                : deleteTarget && t("schedule.deleteDesc", { name: deleteTarget.clientName, date: deleteTarget.date, time: deleteTarget.startTime })
              }
            </p>
          </DialogHeader>
          {deleteTargetForfeitable && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <Checkbox
                id="forfeit-checkbox"
                checked={forfeitChecked}
                onCheckedChange={(v) => setForfeitChecked(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="forfeit-checkbox" className="text-sm font-normal leading-snug cursor-pointer">
                {t("schedule.sameDayForfeitCheckbox")}
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {t("schedule.sameDayForfeitCheckboxDesc")}
                </span>
              </Label>
            </div>
          )}
          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting} className="w-full sm:w-auto">
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDeleteBooking()}
              className="w-full sm:w-auto"
            >
              {deleting && <DumbbellLoader className="w-4 h-4 mr-1" />}
              {deleteTarget?.isBlocked ? t("schedule.yesRelease") : t("schedule.yesDelete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block slot dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("schedule.blockDialogTitle")}</DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              {t("schedule.blockDialogDesc")}
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("schedule.labelDate")}</label>
              <Calendar
                mode="single"
                selected={blockDate}
                onSelect={(d) => { setBlockDate(d); setBlockStartTime(""); setBlockEndTime(""); }}
                locale={ja}
                className="pointer-events-auto border rounded-lg mx-auto"
              />
            </div>
            {blockDate && (
              <>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("schedule.labelStartTime")}</label>
                  <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                    {(() => {
                      const blockDateKey = format(blockDate, "yyyy-MM-dd");
                      const slots: { time: string; blocked: boolean }[] = [];
                      for (let totalMin = 600; totalMin <= 1335; totalMin += 15) {
                        const h = Math.floor(totalMin / 60);
                        const m = totalMin % 60;
                        const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                      const blocked = checkSlotBlocked(bookings, blockDateKey, time, undefined);
                        slots.push({ time, blocked });
                      }
                      return slots.map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={slot.blocked}
                          onClick={() => { setBlockStartTime(slot.time); if (blockEndTime && blockEndTime <= slot.time) setBlockEndTime(""); }}
                          className={`rounded-lg p-2.5 text-xs font-semibold transition-all min-h-[44px] ${
                            slot.blocked
                              ? "bg-muted text-muted-foreground/40 cursor-not-allowed"
                              : blockStartTime === slot.time
                                ? "bg-destructive text-destructive-foreground shadow-md"
                                : "bg-card border border-border hover:border-destructive"
                          }`}
                        >
                          {slot.time}
                          {slot.blocked && <span className="block text-[9px] text-destructive/70">{t("schedule.slotInUse")}</span>}
                        </button>
                      ));
                    })()}
                  </div>
                </div>
                {blockStartTime && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("schedule.labelEndTime")}</label>
                    <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                      {(() => {
                        const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
                        const startMin = toMin(blockStartTime);
                        const slots: { time: string; label: string }[] = [];
                        for (let totalMin = startMin + 15; totalMin <= 1290; totalMin += 15) {
                          const h = Math.floor(totalMin / 60);
                          const m = totalMin % 60;
                          const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                          const dur = totalMin - startMin;
                          const durH = Math.floor(dur / 60);
                          const durM = dur % 60;
                          const label = durH > 0 ? (durM > 0 ? `${durH}h${durM}m` : `${durH}h`) : `${durM}m`;
                          slots.push({ time, label });
                        }
                        return slots.map((slot) => (
                          <button
                            key={slot.time}
                            type="button"
                            onClick={() => setBlockEndTime(slot.time)}
                            className={`rounded-lg p-2.5 text-xs font-semibold transition-all min-h-[44px] ${
                              blockEndTime === slot.time
                                ? "bg-destructive text-destructive-foreground shadow-md"
                                : "bg-card border border-border hover:border-destructive"
                            }`}
                          >
                            {slot.time}
                            <span className="block text-[9px] opacity-60">{slot.label}</span>
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)} className="w-full sm:w-auto">{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={handleBlockSlot} disabled={!blockDate || !blockStartTime || !blockEndTime || submitting} className="w-full sm:w-auto">
              {submitting && <DumbbellLoader className="w-4 h-4 mr-1" />}
              {t("schedule.blockBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TrainerSchedule;
