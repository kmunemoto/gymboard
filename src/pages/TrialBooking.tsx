import { useState, useCallback, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Clock, Check, User, CalendarPlus, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import GymLogo from "@/components/GymLogo";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { formatDate } from "@/lib/dateFormat";
import { toast } from "sonner";
import { getJSTNow, toJSTDate } from "@/lib/timezone";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { GYMBOARD_MARKETING_URL, POWERED_BY_GYMBOARD, POWERED_BY_GYMBOARD_ENABLED } from "@/lib/marketing";

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
}

// この体験予約サイト(app.kyoto-salute.com)は Salute御所南 専用。
// テナント指定なしの /trial は必ずこのジムを既定にする。
// (get_default_tenant_public は「作成が最も古いテナント」を返すため、別テナントが
//  混ざり、空き状況のズレや予約が別テナントに作成される問題を招くため使わない)
const DEFAULT_TENANT_ID = "ceda19b0-d5e0-4928-ab2e-996a0b823af4";

// 予約可能な最大先日数。先すぎる日程は予約時点の意欲が薄れ、当日キャンセルが
// 増えやすいため、心理的に近い期間に寄せる（旧: 1ヶ月先まで）。
// サーバー側 trial-book の MAX_AHEAD_MS と対で管理する値（サーバー側は余裕を持たせた日数）。
const TRIAL_BOOKING_MAX_DAYS_AHEAD = 10;

const TrialBooking = () => {
  const { t } = useTranslation();
  const { tenantId } = useParams<{ tenantId?: string }>();
  // 予約キャンセル画面の「日程を変更する」から遷移した場合、氏名・メールを
  // ?name=&email= で引き継いで入力の手間を省く（未指定なら通常どおり空欄）。
  const [searchParams] = useSearchParams();
  const [tenant, setTenant] = useState<PublicTenant | null>(null);
  const gymName = tenant?.gym_name || t("trialBooking.defaultGymName");
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
      // テナント指定なしの /trial は Salute御所南 を既定にする（このサイトはSalute専用）。
      const resolveId = tenantId || DEFAULT_TENANT_ID;
      const { data, error } = await supabase.rpc("get_tenant_public", { p_id: resolveId });
      if (error) { console.error("Failed to load tenant:", error); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setTenant(row as PublicTenant);
    })();
  }, [tenantId]);

  const effectiveTenantId = tenantId || tenant?.id || DEFAULT_TENANT_ID;

  // テナント限定の埋まり枠を60日分まとめて1回で取得する (get_tenant_booked_slots)
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

  const isSlotBlocked = (date: string, time: string): boolean => {
    const timeToMin = (s: string) => {
      const [h, m] = s.split(":").map(Number);
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

  // 体験予約の締切は会員予約と同じ「前日まで」。予約日の0:00 JST を過ぎたら（＝当日以降）締切。
  // 「満枠(予約済み)」とは別概念なので、表示側でラベルを出し分ける。
  const isBookingDayClosed = (date: string): boolean => {
    const bookingDayStart = new Date(`${date}T00:00:00+09:00`).getTime();
    return Date.now() >= bookingDayStart;
  };

  const generateSlots = () => {
    const slots: { id: string; time: string; available: boolean; blocked: boolean; tooSoon: boolean }[] = [];
    // 締切は日単位（当日以降は全枠締切）。カレンダー側で当日以降は選べないため通常は発生しないが、
    // 日付選択後に日付が変わった場合の保険として枠側でも判定する。
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

  const handleSubmit = async () => {
    if (!guestName.trim()) {
      toast.error(t("trialBooking.errEmptyName"));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!guestEmail.trim() || !emailRegex.test(guestEmail.trim())) {
      toast.error(t("trialBooking.errInvalidEmail"));
      setEmailError(t("trialBooking.errInvalidEmail"));
      return;
    }
    if (!selectedDate || !selectedSlot) return;

    const slot = slots.find((s) => s.id === selectedSlot);
    if (!slot) return;

    setSubmitting(true);

    const bookingDate = `${dateKey}T${slot.time}:00+09:00`;

    const insertTenantId = tenantId || tenant?.id || DEFAULT_TENANT_ID;
    if (!insertTenantId) {
      toast.error(t("trialBooking.errInvalidLink"));
      setSubmitting(false);
      return;
    }

    // 予約作成と通知 (確認メール・トレーナー通知・カレンダー登録) はサーバー側の
    // trial-book で完結する。業務上の拒否は 200 + {ok:false, error} で返る。
    // 日程変更・キャンセルの導線は確認メール側にあるため、完了画面では持たない。
    try {
      const { data, error } = await supabase.functions.invoke("trial-book", {
        body: {
          tenant_id: insertTenantId,
          guest_name: guestName.trim(),
          guest_contact: guestEmail.trim(),
          booking_date: bookingDate,
        },
      });
      const result = data as { ok?: boolean; error?: string; code?: string } | null;
      if (error || !result?.ok) {
        console.error("Trial booking failed:", error ?? result);
        toast.error(result?.error || t("trialBooking.errBookingFailed"));
        if (result?.code === "slot_taken") {
          setSelectedSlot(null);
          fetchExistingSlots();
        }
        setSubmitting(false);
        return;
      }
    } catch (error) {
      console.error("Trial booking failed:", error);
      toast.error(t("trialBooking.errBookingFailed"));
      setSubmitting(false);
      return;
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
  };

  if (completed && completedInfo) {
    const calendarUrl = (() => {
      const dateClean = completedInfo.rawDate.replace(/-/g, "");
      const startClean = completedInfo.rawStartTime.replace(":", "") + "00";
      const endClean = completedInfo.rawEndTime.replace(":", "") + "00";
      const params = new URLSearchParams({
        action: "TEMPLATE",
        text: t("trialBooking.calendarTitleTrial", { gym: gymName }),
        dates: `${dateClean}T${startClean}/${dateClean}T${endClean}`,
        ctz: "Asia/Tokyo",
        details: t("trialBooking.calendarDescription"),
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
        "PRODID:-//GymBoard//Trial Booking//JA",
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
        `UID:trial-${completedInfo.rawDate}-${completedInfo.rawStartTime}@gymboard.app`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=Asia/Tokyo:${dateClean}T${startClean}`,
        `DTEND;TZID=Asia/Tokyo:${dateClean}T${endClean}`,
        `SUMMARY:${t("trialBooking.icsSummary", { gym: gymName })}`,
        `LOCATION:${t("trialBooking.icsLocation")}`,
        `DESCRIPTION:${t("trialBooking.icsDescription")}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gymboard-trial-${completedInfo.rawDate}.ics`;
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
              <h1 className="text-xl font-bold">{t("trialBooking.completedTitle")}</h1>
              <p className="text-sm text-muted-foreground mt-2">{t("trialBooking.completedThanks")}</p>
            </div>
            <div className="bg-accent/10 rounded-xl p-4 space-y-1">
              <p className="text-sm font-bold">{completedInfo.date}</p>
              <p className="text-sm">{completedInfo.time}{t("trialBooking.completedMinutes")}</p>
              <p className="text-xs text-muted-foreground mt-2">{t("trialBooking.completedSubtitle")}</p>
            </div>
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl text-base font-semibold border-2 border-primary text-foreground bg-background hover:bg-secondary transition-all duration-200"
            >
              <CalendarPlus className="w-5 h-5" />
              {t("trialBooking.addGoogleCal")}
            </a>
            <button
              type="button"
              onClick={handleDownloadIcs}
              className="inline-flex items-center justify-center gap-2 w-full h-12 rounded-xl text-base font-semibold border-2 border-primary text-foreground bg-background hover:bg-secondary transition-all duration-200"
            >
              <CalendarPlus className="w-5 h-5" />
              {t("trialBooking.addAppleCal")}
            </button>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>{t("trialBooking.noteContact")}</p>
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
          <h1 className="text-xl font-bold">{t("trialBooking.headerTitle")}</h1>
          <p className="text-sm opacity-80">{t("trialBooking.headerSub")}</p>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        <Card className="border-l-4 border-l-accent bg-accent/5">
          <CardContent className="p-4 flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              {/* ジムごとに設定された案内文があれば優先。未設定なら既定文言。
                  説明文は改行を保持して表示する（whitespace-pre-line）。 */}
              <p className="font-bold text-sm">{tenant?.trial_info_title?.trim() || t("trialBooking.infoTitle")}</p>
              <p className="text-xs text-muted-foreground mt-1 whitespace-pre-line">{tenant?.trial_info_body?.trim() || t("trialBooking.infoBody")}</p>
            </div>
          </CardContent>
        </Card>

        <section className="slide-up">
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <User className="w-3.5 h-3.5" />
            {t("trialBooking.step1")}
          </h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="guest-name" className="text-sm font-medium">
                {t("trialBooking.labelName")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="guest-name"
                placeholder={t("trialBooking.namePlaceholder")}
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="guest-contact" className="text-sm font-medium">
                {t("trialBooking.labelEmail")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="guest-contact"
                type="email"
                placeholder={t("trialBooking.emailPlaceholder")}
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
            {t("trialBooking.step2")}
          </h2>
          <p className="text-xs text-muted-foreground/70 mb-2">{t("trialBooking.step2Note")}</p>

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
                  // 前日まで: 予約日の0:00 JST を過ぎたら（＝当日・過去）選べない
                  if (isBookingDayClosed(yyyyMMdd)) return true;
                  const maxDate = new Date();
                  maxDate.setDate(maxDate.getDate() + TRIAL_BOOKING_MAX_DAYS_AHEAD);
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
                {t("trialBooking.dateOpenSlots", { date: formatDate(selectedDate, "monthDayDow") })}
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
                      <span className="block text-[9px] text-destructive/70 font-medium">
                        {slot.blocked ? t("trialBooking.slotFull") : t("trialBooking.slotClosed")}
                      </span>
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
                        const time = slots.find((s) => s.id === selectedSlot)?.time;
                        if (!time) return "";
                        const [hh, mm] = time.split(":").map(Number);
                        const end = hh * 60 + mm + 60;
                        return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
                      })()}
                    </span>
                    {t("trialBooking.minutesParen")}
                  </p>
                  <Button
                    variant="accent"
                    size="lg"
                    className="w-full"
                    onClick={handleSubmit}
                    disabled={submitting || !guestName.trim() || !guestEmail.trim()}
                  >
                    {submitting ? <DumbbellLoader className="w-4 h-4 mr-2" /> : null}
                    {t("trialBooking.submitBooking")}
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

export default TrialBooking;
