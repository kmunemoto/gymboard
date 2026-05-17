import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Loader2, Trash2, Ban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAllBookings, checkSlotBlocked, createBooking, cancelBooking } from "@/hooks/useBookings";
import { useAllCustomerProfiles } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { format, addDays, startOfWeek, isSameDay } from "date-fns";
import { ja } from "date-fns/locale";
import { getJSTNow } from "@/lib/timezone";
import { toast } from "sonner";
import { sendBookingNotification } from "@/lib/bookingNotification";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import WeekTimelineView from "./WeekTimelineView";
import CourseProgressBadge from "./CourseProgressBadge";
import { getBookingProgressIndex, type BookingForProgress } from "@/lib/courseProgress";


const TrainerSchedule = () => {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(getJSTNow(), { weekStartsOn: 1 }));
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week");
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const [proxyDate, setProxyDate] = useState<Date | undefined>();
  const [proxyTime, setProxyTime] = useState<string>("");
  const [proxyClient, setProxyClient] = useState<string>("");
  const [proxyBookingType, setProxyBookingType] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; clientName: string; date: string; startTime: string; isBlocked?: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockDate, setBlockDate] = useState<Date | undefined>();
  const [blockStartTime, setBlockStartTime] = useState<string>("");
  const [blockEndTime, setBlockEndTime] = useState<string>("");

  const { bookings, loading, refetch, removeBooking } = useAllBookings();
  const { profiles } = useAllCustomerProfiles();

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
      toast.error("日付・時間・お客様・プランを選択してください");
      return;
    }

    if (checkSlotBlocked(bookings, proxyDateKey, proxyTime)) {
      toast.error("すでに予約が入っています。別の時間を選んでください。");
      return;
    }

    setSubmitting(true);
    const { data: bookingData, error } = await createBooking(proxyClient, proxyDateKey, proxyTime, proxyBookingType, true);

    if (error) {
      toast.error("予約の追加に失敗しました");
      setSubmitting(false);
      return;
    }

    const client = profiles.find((p) => p.user_id === proxyClient);
    const [hh, mm] = proxyTime.split(":").map(Number);
    const endMin = hh * 60 + mm + 60;
    const proxyEndTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    toast.success(`${client?.display_name || "顧客"}さんの予約を追加しました（${format(proxyDate, "M/d")} ${proxyTime}）`);
    setProxyDialogOpen(false);
    setProxyDate(undefined);
    setProxyTime("");
    setProxyClient("");
    setProxyBookingType("");
    setSubmitting(false);
    void refetch();

    if (bookingData?.id) {
      sendBookingNotification(bookingData.id, client?.display_name || "顧客", proxyDateKey, proxyTime, proxyEndTime, proxyBookingType, proxyClient);
    }
  };

  const handleDeleteBooking = async () => {
    if (!deleteTarget || deleting) return;

    const target = deleteTarget;
    setDeleting(true);

    // Blocked slot → delete from blocked_slots table
    if (target.isBlocked) {
      const { error } = await supabase.from("blocked_slots").delete().eq("id", target.id);
      if (error) {
        toast.error("ブロック解除に失敗しました");
        setDeleting(false);
        return;
      }
      removeBooking(target.id);
      toast.success("ブロックを解除しました");
      setDeleting(false);
      setDeleteTarget(null);
      return;
    }

    // Trial guest bookings are in trial_bookings table
    const booking = bookings.find((b) => b.id === target.id);
    let error: { code?: string; message?: string } | null | undefined;
    if (booking?.user_id === "trial-guest") {
      // Fetch google_event_id before deleting
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

      const res = await supabase.from("trial_bookings").delete().eq("id", target.id);
      error = res.error;
    } else {
      const res = await cancelBooking(target.id, true);
      error = res.error;
    }

    if (error) {
      console.error("Failed to delete booking:", error);
      const isPermissionError = error.code === "42501" || error.message?.includes("row-level security");
      toast.error(isPermissionError ? "削除権限がありません" : "エラーが発生しました");
      setDeleting(false);
      return;
    }

    removeBooking(target.id);
    toast.success("予約を削除しました");
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleBlockSlot = async () => {
    if (!blockDate || !blockStartTime || !blockEndTime || !user) return;
    const dateStr = format(blockDate, "yyyy-MM-dd");

    if (blockEndTime <= blockStartTime) {
      toast.error("終了時間は開始時間より後にしてください");
      return;
    }

    // Check if the range overlaps with any existing booking/block
    if (checkSlotBlocked(bookings, dateStr, blockStartTime, blockEndTime)) {
      toast.error("この時間帯にはすでに予約またはブロックが入っています");
      return;
    }

    setSubmitting(true);
    const row = {
      blocked_date: `${dateStr}T${blockStartTime}:00+09:00`,
      end_blocked_date: `${dateStr}T${blockEndTime}:00+09:00`,
      created_by: user.id,
      reason: `ブロック（${blockStartTime}〜${blockEndTime}）`,
    };

    const { error } = await supabase.from("blocked_slots").insert(row);

    if (error) {
      toast.error("ブロックに失敗しました");
      setSubmitting(false);
      return;
    }

    toast.success(`${format(blockDate, "M/d")} ${blockStartTime}〜${blockEndTime} をブロックしました`);
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
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="pb-24 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
        <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-accent" />
          予約管理
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBlockDialogOpen(true)} className="gap-1.5">
            <Ban className="w-3.5 h-3.5" />
            時間ブロック
          </Button>
          <Button variant="outline" size="sm" onClick={() => setProxyDialogOpen(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            代理予約
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
            今日
          </Button>
        </div>
      </div>

      {/* 表示モード切替 */}
      <div className="flex items-center gap-1 mb-3 p-1 bg-muted/40 rounded-lg w-fit">
        {([
          { key: "day", label: "日別" },
          { key: "week", label: "週間" },
          { key: "month", label: "月間" },
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
            {m.key === "month" && <span className="ml-1 text-[9px]">(準備中)</span>}
          </button>
        ))}
      </div>

      {/* 週間タイムライン表示 */}
      {viewMode === "week" && (
        <WeekTimelineView
          weekStart={weekStart}
          bookings={bookings}
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
                    <th className="p-3 text-xs font-bold text-muted-foreground w-16">時間</th>
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
                                    : "accent-gradient text-accent-foreground"
                                }`}>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    aria-label={session.isBlocked ? "ブロック解除" : `${session.clientName}さんの予約を削除`}
                                    onClick={() => setDeleteTarget({ id: session.id, clientName: session.clientName, date: session.date, startTime: session.startTime, isBlocked: session.isBlocked })}
                                    className="absolute top-1 right-1 h-7 w-7 rounded-md"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                  <p className="font-bold truncate">{session.isBlocked ? "ブロック" : session.clientName}</p>
                                  <p className="opacity-75 truncate">{session.startTime}〜{session.endTime}</p>
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
                  {format(day, "M/d（E）", { locale: ja })}
                </span>
                {isToday && <span className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded-full font-bold">今日</span>}
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
                              booking.isBlocked ? "bg-muted text-muted-foreground" : "accent-gradient text-accent-foreground"
                            }`}>
                              {booking.isBlocked ? "—" : booking.clientName[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{booking.isBlocked ? "ブロック" : booking.clientName}</p>
                              <p className="text-xs text-muted-foreground">{booking.startTime}〜{booking.endTime}</p>
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
                              onClick={() => setDeleteTarget({ id: booking.id, clientName: booking.clientName, date: booking.date, startTime: booking.startTime, isBlocked: booking.isBlocked })}
                              className="min-w-[112px]"
                            >
                              <Trash2 className="w-4 h-4" />
                              {booking.isBlocked ? "解除" : "削除"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pl-1 mb-1">予約なし</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded accent-gradient" />
          <span className="text-xs text-muted-foreground">予約あり</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded border border-dashed border-destructive/30 bg-muted" />
          <span className="text-xs text-muted-foreground">ブロック</span>
        </div>
      </div>
        </>
      )}

      {viewMode === "month" && (
        <div className="border rounded-xl bg-card p-8 text-center text-sm text-muted-foreground">
          月間ビューは準備中です
        </div>
      )}

      <Dialog open={proxyDialogOpen} onOpenChange={setProxyDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>代理予約</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">お客様</label>
              <select
                value={proxyClient}
                onChange={(e) => {
                  const selectedUserId = e.target.value;
                  setProxyClient(selectedUserId);
                  const selectedProfile = profiles.find((p) => p.user_id === selectedUserId);
                  if (selectedProfile?.plan) {
                    setProxyBookingType(selectedProfile.plan);
                  }
                }}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="" disabled>選択してください</option>
                {profiles.map((p) => (
                  <option key={p.user_id} value={p.user_id}>{p.display_name || "不明"}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">予約プラン</label>
              <select
                value={proxyBookingType}
                onChange={(e) => setProxyBookingType(e.target.value)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="" disabled>選択してください</option>
                <option value="初回無料体験">初回無料体験</option>
                <option value="月4回">月4回</option>
                <option value="月6回">月6回</option>
                <option value="月8回">月8回</option>
                <option value="通い放題">通い放題</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">日付</label>
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
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">開始時間</label>
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
                        {slot.blocked && <span className="block text-[9px] text-destructive/70">満枠</span>}
                      </button>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setProxyDialogOpen(false)} className="w-full sm:w-auto">キャンセル</Button>
            <Button variant="accent" onClick={handleProxyBook} disabled={!proxyDate || !proxyTime || !proxyClient || submitting} className="w-full sm:w-auto">
              {submitting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              予約する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{deleteTarget?.isBlocked ? "ブロックを解除しますか？" : "予約を削除しますか？"}</DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              {deleteTarget?.isBlocked
                ? `${deleteTarget.date} ${deleteTarget.startTime} のブロックを解除します。この時間帯に予約が入れられるようになります。`
                : deleteTarget && `${deleteTarget.clientName}さんの予約（${deleteTarget.date} ${deleteTarget.startTime}）を削除します。本当にこの予約を削除しますか？元に戻すことはできません。`
              }
            </p>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting} className="w-full sm:w-auto">
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDeleteBooking()}
              className="w-full sm:w-auto"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {deleteTarget?.isBlocked ? "はい、解除する" : "はい、削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Block slot dialog */}
      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>時間帯をブロック</DialogTitle>
            <p className="text-sm text-muted-foreground pt-1">
              選択した時間帯に予約が入らないようにブロックします。
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">日付</label>
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
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">開始時間</label>
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
                          {slot.blocked && <span className="block text-[9px] text-destructive/70">使用中</span>}
                        </button>
                      ));
                    })()}
                  </div>
                </div>
                {blockStartTime && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">終了時間</label>
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
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)} className="w-full sm:w-auto">キャンセル</Button>
            <Button variant="destructive" onClick={handleBlockSlot} disabled={!blockDate || !blockStartTime || !blockEndTime || submitting} className="w-full sm:w-auto">
              {submitting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              ブロックする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TrainerSchedule;
