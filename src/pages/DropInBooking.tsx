import { useState, useCallback, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Clock, Check, User, CalendarPlus, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import GymLogo from "@/components/GymLogo";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import { toast } from "sonner";
import { getJSTNow, toJSTDate } from "@/lib/timezone";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { GYMBOARD_MARKETING_URL, POWERED_BY_GYMBOARD, POWERED_BY_GYMBOARD_ENABLED } from "@/lib/marketing";
import { LEGACY_DEFAULT_TENANT_ID } from "@/lib/legacyDefaultTenant";

// TrialBooking.tsx の複製（英語圏の観光客向け「単発ドロップインセッション ¥8,000・
// 会員登録不要・現地決済」専用ページ）。無料体験(/trial)とは見出し・文言・言語が別物のため
// 別ページとして複製し、無料体験側は一切変更しない。予約フロー・空き枠判定の仕組みは
// 同一（サーバー側 drop-in-book が同じ trial_bookings テーブルに booking_kind='drop_in' で
// 書き込むため、無料体験・会員予約と同じカレンダー枠を正しく共有する）。
// このページは常に英語固定（i18next を使わない）。訪問者のブラウザ言語に関わらず、
// 対象読者（英語圏の観光客）向けに固定する意図的な選択。

interface TrialSlotBooking {
  date: string;
  startTime: string;
  endTime: string;
}

interface PublicTenant {
  id: string;
  gym_name: string;
  gym_name_short: string | null;
  address: string | null;
  logo_url: string | null;
  primary_color: string | null;
  trial_info_title: string | null;
  trial_info_body: string | null;
  booking_buffer_minutes: number | null;
  slot_duration_minutes: number | null;
}

// テナント指定なしの場合の既定テナント。既存リンク互換のためのレガシーシムで、
// 撤去手順は legacyDefaultTenant.ts のコメントを参照。
const DEFAULT_TENANT_ID = LEGACY_DEFAULT_TENANT_ID;

const DROP_IN_BOOKING_MAX_DAYS_AHEAD = 10;

const DropInBooking = () => {
  const { tenantId } = useParams<{ tenantId?: string }>();
  const [searchParams] = useSearchParams();
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const gymName = tenant?.gym_name || "the gym";
  const [guestName, setGuestName] = useState(() => searchParams.get("name") ?? "");
  const [guestEmail, setGuestEmail] = useState(() => searchParams.get("email") ?? "");
  const [emailError, setEmailError] = useState("");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completedInfo, setCompletedInfo] = useState<{ date: string; time: string; rawDate: string; rawStartTime: string; rawEndTime: string } | null>(null);
  const [existingBookings, setExistingBookings] = useState<TrialSlotBooking[]>([]);

  useEffect(() => {
    (async () => {
      const resolveId = tenantId || DEFAULT_TENANT_ID;
      const { data, error } = await supabase.rpc("get_tenant_public", { p_id: resolveId });
      if (error) { console.error("Failed to load tenant:", error); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setTenant(row as PublicTenant);
    })();
  }, [tenantId]);

  const effectiveTenantId = tenantId || tenant?.id || DEFAULT_TENANT_ID;

  // 空き枠は無料体験・会員予約と同じ RPC (get_tenant_booked_slots) で取得する。
  // trial_bookings / bookings / blocked_slots を横断して埋まり区間を返すため、
  // ドロップイン予約も他の予約と同じカレンダーとして正しく重複判定される。
  const fetchExistingSlots = useCallback(async () => {
    if (!effectiveTenantId) return;
    const today = getJSTNow();
    const end = new Date(today);
    end.setDate(today.getDate() + 59);
    const { data } = await supabase.rpc("get_tenant_booked_slots" as any, {
      p_tenant_id: effectiveTenantId,
      from_date: format(today, "yyyy-MM-dd"),
      to_date: format(end, "yyyy-MM-dd"),
    });
    const slots: TrialSlotBooking[] = [];
    (data as { booking_date: string; end_booking_date: string; status: string }[] | null)?.forEach((r) => {
      if (r.status === "キャンセル済み") return;
      const dt = toJSTDate(r.booking_date);
      const endDt = toJSTDate(r.end_booking_date);
      slots.push({
        date: format(dt, "yyyy-MM-dd"),
        startTime: `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`,
        endTime: `${String(endDt.getHours()).padStart(2, "0")}:${String(endDt.getMinutes()).padStart(2, "0")}`,
      });
    });
    setExistingBookings(slots);
  }, [effectiveTenantId]);

  useEffect(() => {
    fetchExistingSlots();
  }, [fetchExistingSlots]);

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";

  const bookingBufferMinutes = tenant?.booking_buffer_minutes ?? 15;
  const sessionMinutes = tenant?.slot_duration_minutes ?? 60;

  const isSlotBlocked = (date: string, time: string): boolean => {
    const timeToMin = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return h * 60 + m;
    };
    const newMin = timeToMin(time);
    const newEnd = newMin + sessionMinutes + bookingBufferMinutes;
    return existingBookings.some((b) => {
      if (b.date !== date) return false;
      const bMin = timeToMin(b.startTime);
      const bEnd = timeToMin(b.endTime);
      return newMin < bEnd && bMin < newEnd;
    });
  };

  // ドロップインの締切も無料体験・会員予約と同じ「前日まで」。
  const isBookingDayClosed = (date: string): boolean => {
    const bookingDayStart = new Date(`${date}T00:00:00+09:00`).getTime();
    return Date.now() >= bookingDayStart;
  };

  const generateSlots = () => {
    const slots: { id: string; time: string; available: boolean; blocked: boolean; tooSoon: boolean }[] = [];
    const tooSoon = isBookingDayClosed(dateKey);
    for (let totalMin = 600; totalMin <= 1260; totalMin += 15) {
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const blocked = isSlotBlocked(dateKey, time);
      slots.push({ id: `${dateKey}-${time}`, time, available: !blocked && !tooSoon, blocked, tooSoon });
    }
    return slots;
  };

  const slots = dateKey ? generateSlots() : [];

  // 表示用の12時間制フォーマット (英語圏向け)
  const formatTime12h = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  };

  const handleSubmit = async () => {
    if (!guestName.trim()) {
      toast.error("Please enter your name.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!guestEmail.trim() || !emailRegex.test(guestEmail.trim())) {
      toast.error("Please enter a valid email address.");
      setEmailError("Please enter a valid email address.");
      return;
    }
    if (!selectedDate || !selectedSlot) return;

    const slot = slots.find((s) => s.id === selectedSlot);
    if (!slot) return;

    setSubmitting(true);

    const bookingDate = `${dateKey}T${slot.time}:00+09:00`;

    const insertTenantId = tenantId || tenant?.id || DEFAULT_TENANT_ID;
    if (!insertTenantId) {
      toast.error("This booking link is invalid.");
      setSubmitting(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("drop-in-book", {
        body: {
          tenant_id: insertTenantId,
          guest_name: guestName.trim(),
          guest_contact: guestEmail.trim(),
          booking_date: bookingDate,
        },
      });
      const result = data as { ok?: boolean; error?: string; code?: string } | null;
      if (error || !result?.ok) {
        console.error("Drop-in booking failed:", error ?? result);
        toast.error(result?.error || "Booking failed. Please try again.");
        if (result?.code === "slot_taken") {
          setSelectedSlot(null);
          fetchExistingSlots();
        }
        setSubmitting(false);
        return;
      }
    } catch (error) {
      console.error("Drop-in booking failed:", error);
      toast.error("Booking failed. Please try again.");
      setSubmitting(false);
      return;
    }

    const [h, m] = slot.time.split(":").map(Number);
    const endMin = h * 60 + m + sessionMinutes;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    setCompletedInfo({
      date: format(selectedDate, "MMM d (EEE)", { locale: enUS }),
      time: `${formatTime12h(slot.time)} - ${formatTime12h(endTime)}`,
      rawDate: dateKey,
      rawStartTime: slot.time,
      rawEndTime: endTime,
    });
    setCompleted(true);
    setSubmitting(false);
  };

  if (completed && completedInfo) {
    const calendarUrl = (() => {
      const dateClean = completedInfo.rawDate.replace(/-/g, "");
      const startClean = completedInfo.rawStartTime.replace(":", "") + "00";
      const endClean = completedInfo.rawEndTime.replace(":", "") + "00";
      const params = new URLSearchParams({
        action: "TEMPLATE",
        text: `Drop-in Session at ${gymName}`,
        dates: `${dateClean}T${startClean}/${dateClean}T${endClean}`,
        ctz: "Asia/Tokyo",
        details: "Drop-in session (¥8,000, payable on-site).",
        location: gymName,
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
        "PRODID:-//GymBoard//Drop-in Booking//EN",
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
        `UID:dropin-${completedInfo.rawDate}-${completedInfo.rawStartTime}@gymboard.app`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=Asia/Tokyo:${dateClean}T${startClean}`,
        `DTEND;TZID=Asia/Tokyo:${dateClean}T${endClean}`,
        `SUMMARY:Drop-in Session at ${gymName}`,
        `LOCATION:${gymName}`,
        "DESCRIPTION:Drop-in session (\\u00a58\\,000\\, payable on-site).",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gymboard-dropin-${completedInfo.rawDate}.ics`;
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
              <h1 className="text-xl font-bold">Booking Confirmed!</h1>
              <p className="text-sm text-muted-foreground mt-2">Thank you — we look forward to seeing you.</p>
            </div>
            <div className="bg-accent/10 rounded-xl p-4 space-y-1">
              <p className="text-sm font-bold">{completedInfo.date}</p>
              <p className="text-sm">{completedInfo.time}</p>
              <p className="text-xs text-muted-foreground mt-2">¥8,000 — payable on-site (cash or card)</p>
            </div>
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl text-base font-semibold border-2 border-primary text-foreground bg-background hover:bg-secondary transition-all duration-200"
            >
              <CalendarPlus className="w-5 h-5" />
              Add to Google Calendar
            </a>
            <button
              type="button"
              onClick={handleDownloadIcs}
              className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl text-base font-semibold border-2 border-primary text-foreground bg-background hover:bg-secondary transition-all duration-200"
            >
              <CalendarPlus className="w-5 h-5" />
              Add to Apple Calendar
            </button>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>A confirmation email has been sent to you. If you need to cancel or reschedule, please contact the gym at least one day before your visit.</p>
            </div>
            <div className="flex justify-center items-center pt-2">
              {tenant?.logo_url ? (
                <img
                  src={tenant.logo_url}
                  alt={gymName}
                  width={32}
                  height={32}
                  loading="lazy"
                  decoding="async"
                  className="w-8 h-8 rounded object-contain bg-white"
                />
              ) : (
                <GymLogo size="sm" />
              )}
              <span className="ml-2 text-sm font-bold text-muted-foreground">{gymName}</span>
            </div>
            {POWERED_BY_GYMBOARD_ENABLED && (
              <a
                href={GYMBOARD_MARKETING_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors pt-1"
              >
                {POWERED_BY_GYMBOARD}
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="gym-gradient p-6 text-center text-primary-foreground relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-accent/10 -translate-y-10 translate-x-10" />
        <div className="relative space-y-2">
          <div className="flex justify-center">
            {tenant?.logo_url ? (
              <img
                src={tenant.logo_url}
                alt={gymName}
                width={96}
                height={96}
                loading="eager"
                decoding="async"
                // @ts-expect-error fetchpriority is valid but not yet in TS DOM types
                fetchpriority="high"
                className="w-24 h-24 rounded object-contain bg-white"
              />
            ) : (
              <GymLogo size="lg" />
            )}
          </div>
          <h1 className="text-xl font-bold">Drop-in Session</h1>
          <p className="text-sm opacity-80">Book a single training session — no membership required</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        <Card className="border-l-4 border-l-accent bg-accent/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">¥8,000 per session (approx. $55 USD)</p>
              <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">
                Payment is made on-site (cash or credit card) — no online payment or membership sign-up needed.{"\n"}
                Workout wear, shoes and water are provided free of charge, so you can come as you are.
              </p>
            </div>
          </CardContent>
        </Card>

        <section className="slide-up">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            Step 1: Your Details
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="guest-name" className="text-sm font-medium">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="guest-name"
                placeholder="John Smith"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="guest-contact" className="text-sm font-medium">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="guest-contact"
                type="email"
                placeholder="you@example.com"
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

        <section className="slide-up">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            Step 2: Select Date &amp; Time
          </h2>
          <p className="text-xs text-muted-foreground/70 mb-2">Bookings must be made by the day before your visit.</p>

          <Card>
            <CardContent className="p-3 flex justify-center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => {
                  setSelectedDate(d);
                  setSelectedSlot(null);
                  setTimeout(() => {
                    document.getElementById("dropin-time-slots")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 100);
                }}
                locale={enUS}
                disabled={(date) => {
                  const yyyyMMdd = format(date, "yyyy-MM-dd");
                  if (isBookingDayClosed(yyyyMMdd)) return true;
                  const maxDate = new Date();
                  maxDate.setDate(maxDate.getDate() + DROP_IN_BOOKING_MAX_DAYS_AHEAD);
                  return date.getTime() > maxDate.getTime();
                }}
                className="pointer-events-auto"
              />
            </CardContent>
          </Card>

          {selectedDate && (
            <div id="dropin-time-slots" className="mt-4 slide-up">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {`Available times — ${format(selectedDate, "MMM d (EEE)", { locale: enUS })}`}
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
                        document.getElementById("dropin-confirm-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
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
                    <span>{formatTime12h(slot.time)}</span>
                    {!slot.available && (
                      <span className="block text-[9px] text-destructive/70 font-medium">
                        {slot.blocked ? "Full" : "Closed"}
                      </span>
                    )}
                    {selectedSlot === slot.id && (
                      <Check className="w-2.5 h-2.5 absolute top-0.5 right-0.5" />
                    )}
                  </button>
                ))}
              </div>

              {selectedSlot && (
                <div id="dropin-confirm-section" className="mt-3 p-3 rounded-xl bg-accent/10 border border-accent/20">
                  <p className="text-sm text-center mb-3">
                    <span className="font-bold">{formatTime12h(slots.find((s) => s.id === selectedSlot)?.time ?? "")}</span>
                    {" - "}
                    <span className="font-bold">
                      {(() => {
                        const time = slots.find((s) => s.id === selectedSlot)?.time;
                        if (!time) return "";
                        const [hh, mm] = time.split(":").map(Number);
                        const end = hh * 60 + mm + sessionMinutes;
                        return formatTime12h(`${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`);
                      })()}
                    </span>
                    {` (${sessionMinutes} min)`}
                  </p>
                  <Button
                    variant="accent"
                    size="lg"
                    className="w-full"
                    onClick={handleSubmit}
                    disabled={submitting || !guestName.trim() || !guestEmail.trim()}
                  >
                    {submitting ? <DumbbellLoader className="w-4 h-4 mr-2" /> : null}
                    Book Now — ¥8,000 (pay on-site)
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        {POWERED_BY_GYMBOARD_ENABLED && (
          <a
            href={GYMBOARD_MARKETING_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors pt-2"
          >
            {POWERED_BY_GYMBOARD}
          </a>
        )}
      </div>
    </div>
  );
};

export default DropInBooking;
