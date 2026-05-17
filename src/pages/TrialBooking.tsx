import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Clock, Check, Loader2, User, CalendarPlus, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import GymLogo from "@/components/GymLogo";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { getJSTNow, toJSTDate } from "@/lib/timezone";

interface TrialSlotBooking {
  date: string;
  startTime: string;
  endTime: string;
}

const TrialBooking = () => {
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completedInfo, setCompletedInfo] = useState<{ date: string; time: string; rawDate: string; rawStartTime: string; rawEndTime: string } | null>(null);
  const [existingBookings, setExistingBookings] = useState<TrialSlotBooking[]>([]);

  // Fetch all existing bookings via secure RPC (no PII exposed)
  const fetchExistingSlots = useCallback(async () => {
    // Fetch slots for upcoming 60 days using the secure RPC
    const slots: TrialSlotBooking[] = [];
    const today = getJSTNow();
    const promises = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = format(d, "yyyy-MM-dd");
      promises.push(
        supabase.rpc("get_booked_slots", { check_date: dateStr }).then(({ data }: { data: any }) => {
          data?.forEach((r: { booking_date: string; end_booking_date: string; status: string }) => {
            if (r.status === "キャンセル済み") return;
            const dt = toJSTDate(r.booking_date);
            const endDt = toJSTDate(r.end_booking_date);
            slots.push({
              date: format(dt, "yyyy-MM-dd"),
              startTime: `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`,
              endTime: `${String(endDt.getHours()).padStart(2, "0")}:${String(endDt.getMinutes()).padStart(2, "0")}`,
            });
          });
        })
      );
    }
    await Promise.all(promises);
    setExistingBookings(slots);
  }, []);

  useEffect(() => {
    fetchExistingSlots();
  }, [fetchExistingSlots]);

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";

  const isSlotBlocked = (date: string, time: string): boolean => {
    const timeToMin = (t: string) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m;
    };
    const newMin = timeToMin(time);
    return existingBookings.some((b) => {
      if (b.date !== date) return false;
      const bMin = timeToMin(b.startTime);
      const bEnd = timeToMin(b.endTime);
      return newMin < bEnd && bMin < newMin + 75;
    });
  };

  const isSlotWithin24Hours = (date: string, time: string): boolean => {
    // Real UTC instant comparison — JST offset baked into the slot ISO string.
    const slotInstant = new Date(`${date}T${time}:00+09:00`).getTime();
    return slotInstant - Date.now() < 24 * 60 * 60 * 1000;
  };

  const generateSlots = () => {
    const slots: { id: string; time: string; available: boolean }[] = [];
    for (let totalMin = 600; totalMin <= 1260; totalMin += 15) {
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const blocked = isSlotBlocked(dateKey, time);
      const tooSoon = isSlotWithin24Hours(dateKey, time);
      slots.push({ id: `${dateKey}-${time}`, time, available: !blocked && !tooSoon });
    }
    return slots;
  };

  const slots = dateKey ? generateSlots() : [];

  const handleSubmit = async () => {
    if (!guestName.trim()) {
      toast.error("お名前を入力してください");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!guestEmail.trim() || !emailRegex.test(guestEmail.trim())) {
      toast.error("正しいメールアドレスを入力してください");
      setEmailError("正しいメールアドレスを入力してください");
      return;
    }
    if (!selectedDate || !selectedSlot) return;

    const slot = slots.find((s) => s.id === selectedSlot);
    if (!slot) return;

    setSubmitting(true);

    const bookingDate = `${dateKey}T${slot.time}:00+09:00`;

    const bookingId = crypto.randomUUID();
    const insertedBooking = { id: bookingId, booking_date: bookingDate };

    try {
      const { error } = await supabase.from("trial_bookings").insert({
        id: bookingId,
        guest_name: guestName.trim(),
        guest_contact: guestEmail.trim(),
        booking_date: bookingDate,
      });

      if (error) {
        console.error("Trial booking failed:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          error,
        });
        toast.error("予約に失敗しました。もう一度お試しください。");
        setSubmitting(false);
        return;
      }
    } catch (error: any) {
      console.error("Trial booking failed:", {
        message: error?.message,
        code: error?.code,
        error,
      });
      toast.error("予約に失敗しました。もう一度お試しください。");
      setSubmitting(false);
      return;
    }

    // Sync to Google Calendar (fire-and-forget)
    if (insertedBooking) {
      supabase.functions.invoke("google-calendar-sync", {
        body: {
          action: "create",
          booking_id: insertedBooking.id,
          booking_date: insertedBooking.booking_date,
          booking_type: "初回無料体験",
          client_name: `🆕 ${guestName.trim()}`,
          is_trial: true,
        },
      }).catch(console.error);
    }

    const [h, m] = slot.time.split(":").map(Number);
    const endMin = h * 60 + m + 60;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    setCompletedInfo({
      date: format(selectedDate, "M月d日（E）", { locale: ja }),
      time: `${slot.time}〜${endTime}`,
      rawDate: dateKey,
      rawStartTime: slot.time,
      rawEndTime: endTime,
    });
    setCompleted(true);
    setSubmitting(false);

    const formattedDate = format(selectedDate, "M月d日（E）", { locale: ja });

    // Fire-and-forget: send booking confirmation email to customer
    (async () => {
      try {
        await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "trial-booking-confirmation",
            recipientEmail: guestEmail.trim(),
            idempotencyKey: `trial-confirm-${guestEmail.trim()}-${bookingDate}`,
            templateData: {
              customerName: guestName.trim(),
              bookingDate: formattedDate,
              bookingTime: `${slot.time}〜${endTime}`,
            },
          },
        });
      } catch (e) {
        console.error("Booking confirmation email failed:", e);
      }
    })();

    // Fire-and-forget: notify trainer via LINE
    (async () => {
      try {
        const { data: trainerRoles } = await supabase.rpc("get_trainer_ids");
        const trainerId = trainerRoles?.[0]?.user_id;
        if (!trainerId) return;

        const message = `【Salute御所南】🎉 新規の体験予約が入りました！\n\n・お名前：${guestName.trim()} 様\n・日時：${formattedDate} ${slot.time}〜${endTime}\n\nアプリの予約管理画面から詳細を確認してください。`;

        await supabase.functions.invoke("send-line-message", {
          body: { user_id: trainerId, message },
        });
      } catch (e) {
        console.error("LINE notification failed:", e);
      }
    })();

    // Fire-and-forget: notify trainer via email
    (async () => {
      try {
        const { data: trainerRoles } = await supabase.rpc("get_trainer_ids");
        const trainerId = trainerRoles?.[0]?.user_id;
        if (!trainerId) return;

        await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "new-booking-notification",
            recipientEmail: "_resolve_trainer_",
            idempotencyKey: `trial-notify-${guestEmail.trim()}-${bookingDate}`,
            templateData: {
              customerName: `🆕 ${guestName.trim()}（初回無料体験）`,
              bookingDate: formattedDate,
              bookingTime: `${slot.time}〜${endTime}`,
              planName: "初回無料体験",
              dashboardUrl: window.location.origin,
              trainerUserId: trainerId,
            },
          },
        });
      } catch (e) {
        console.error("Trainer email notification failed:", e);
      }
    })();
  };

  if (completed && completedInfo) {
    const calendarUrl = (() => {
      const dateClean = completedInfo.rawDate.replace(/-/g, "");
      const startClean = completedInfo.rawStartTime.replace(":", "") + "00";
      const endClean = completedInfo.rawEndTime.replace(":", "") + "00";
      const params = new URLSearchParams({
        action: "TEMPLATE",
        text: "【初回無料体験】パーソナルジムSalute御所南",
        dates: `${dateClean}T${startClean}/${dateClean}T${endClean}`,
        ctz: "Asia/Tokyo",
        details: "初回無料体験（カウンセリング＋トレーニング）。\n当日は動きやすい服装でお越しください。\nご不明な点がございましたらお気軽にお問い合わせください。",
        location: "パーソナルジムSalute御所南",
      });
      return `https://calendar.google.com/calendar/render?${params.toString()}`;
    })();

    const handleDownloadIcs = () => {
      const dateClean = completedInfo.rawDate.replace(/-/g, "");
      const startClean = completedInfo.rawStartTime.replace(":", "") + "00";
      const endClean = completedInfo.rawEndTime.replace(":", "") + "00";
      const dtstamp = format(getJSTNow(), "yyyyMMdd'T'HHmmss");
      const ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Salute Goshominami//Trial Booking//JA",
        "CALSCALE:GREGORIAN",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Tokyo",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0900",
        "TZOFFSETTO:+0900",
        "TZNAME:JST",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        `UID:trial-${completedInfo.rawDate}-${completedInfo.rawStartTime}@kyoto-salute.com`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=Asia/Tokyo:${dateClean}T${startClean}`,
        `DTEND;TZID=Asia/Tokyo:${dateClean}T${endClean}`,
        "SUMMARY:【Salute御所南】初回無料体験",
        "LOCATION:京都市中京区毘沙門町533-1 プラザ御所南2階",
        "DESCRIPTION:カウンセリング＋トレーニング体験（計60分）\\n動きやすい服装でお越しください。",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `salute-trial-${completedInfo.rawDate}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md slide-up">
          <CardContent className="p-8 text-center space-y-5">
            <div className="w-16 h-16 rounded-full accent-gradient flex items-center justify-center mx-auto">
              <Check className="w-8 h-8 text-accent-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold">ご予約を受け付けました！</h1>
              <p className="text-sm text-muted-foreground mt-2">
                初回無料体験のご予約ありがとうございます。
              </p>
            </div>
            <div className="bg-accent/10 rounded-xl p-4 space-y-1">
              <p className="text-sm font-bold">{completedInfo.date}</p>
              <p className="text-sm">{completedInfo.time}（60分）</p>
              <p className="text-xs text-muted-foreground mt-2">カウンセリング＋トレーニング体験</p>
            </div>
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl text-base font-semibold border-2 border-primary text-foreground bg-background hover:bg-secondary transition-all duration-200"
            >
              <CalendarPlus className="w-5 h-5" />
              Googleカレンダーに登録
            </a>
            <button
              type="button"
              onClick={handleDownloadIcs}
              className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl text-base font-semibold border-2 border-primary text-foreground bg-background hover:bg-secondary transition-all duration-200"
            >
              <CalendarPlus className="w-5 h-5" />
              Appleカレンダーに登録
            </button>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>当日は動きやすい服装でお越しください。</p>
              <p>ご不明な点がございましたらお気軽にお問い合わせください。</p>
            </div>
            <div className="flex justify-center pt-2">
              <GymLogo size="sm" />
              <span className="ml-2 text-sm font-bold text-muted-foreground">パーソナルジムSalute御所南</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="gym-gradient p-6 text-center text-primary-foreground relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-accent/10 -translate-y-10 translate-x-10" />
        <div className="relative space-y-2">
          <div className="flex justify-center">
            <GymLogo size="lg" />
          </div>
          <h1 className="text-xl font-bold">初回無料体験</h1>
          <p className="text-sm opacity-80">カウンセリング＋トレーニング（計60分）</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        {/* Info banner */}
        <Card className="border-l-4 border-l-accent bg-accent/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">完全無料・手ぶらOK</p>
              <p className="text-xs text-muted-foreground mt-1">
                初めての方限定の無料体験です。プロのトレーナーがマンツーマンでサポートいたします。
              </p>
            </div>
          </CardContent>
        </Card>

        {/* STEP 1: Guest info */}
        <section className="slide-up">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            STEP 1 — お客様情報
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="guest-name" className="text-sm font-medium">
                お名前 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="guest-name"
                placeholder="例：山田 太郎"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="guest-contact" className="text-sm font-medium">
                メールアドレス <span className="text-destructive">*</span>
              </Label>
              <Input
                id="guest-contact"
                type="email"
                placeholder="例：example@mail.com"
                value={guestEmail}
                onChange={(e) => {
                  setGuestEmail(e.target.value);
                  setEmailError("");
                }}
                className={`mt-1 ${emailError ? "border-destructive" : ""}`}
              />
              {emailError && (
                <p className="text-[11px] text-destructive mt-1">{emailError}</p>
              )}
            </div>
          </div>
        </section>

        {/* STEP 2: Date & time */}
        <section className="slide-up">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            STEP 2 — 希望日時を選択
          </h2>
          <p className="text-xs text-muted-foreground/70 mb-2">※ご予約は24時間前までにお願いいたします</p>

          <Card>
            <CardContent className="p-3 flex justify-center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => {
                  setSelectedDate(d);
                  setSelectedSlot(null);
                  setTimeout(() => {
                    document.getElementById("trial-time-slots")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 100);
                }}
                locale={ja}
                disabled={(date) => {
                  const yyyyMMdd = format(date, "yyyy-MM-dd");
                  const latestSlot = new Date(`${yyyyMMdd}T20:15:00+09:00`);
                  if (latestSlot.getTime() - Date.now() < 24 * 60 * 60 * 1000) return true;
                  // 1ヶ月先までのみ予約可能
                  const maxDate = new Date();
                  maxDate.setMonth(maxDate.getMonth() + 1);
                  return date.getTime() > maxDate.getTime();
                }}
                className="pointer-events-auto"
              />
            </CardContent>
          </Card>

          {selectedDate && (
            <div id="trial-time-slots" className="mt-4 slide-up">
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
                        document.getElementById("trial-confirm-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
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
                <div id="trial-confirm-section" className="mt-3 p-3 rounded-xl bg-accent/10 border border-accent/20">
                  <p className="text-sm text-center mb-3">
                    <span className="font-bold">{slots.find((s) => s.id === selectedSlot)?.time}</span>
                    〜
                    <span className="font-bold">
                      {(() => {
                        const t = slots.find((s) => s.id === selectedSlot)?.time;
                        if (!t) return "";
                        const [h, m] = t.split(":").map(Number);
                        const end = h * 60 + m + 60;
                        return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
                      })()}
                    </span>
                    （60分）
                  </p>
                  <Button
                    variant="accent"
                    size="lg"
                    className="w-full"
                    onClick={handleSubmit}
                    disabled={submitting || !guestName.trim() || !guestEmail.trim()}
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    無料体験を予約する
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default TrialBooking;
