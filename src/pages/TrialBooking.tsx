import { useState, useCallback, useEffect } from "react";
import { isSlotPastCutoff, isDayPastCutoff } from "@/lib/bookingCutoff";
import { bookingSlotMinutes, isClosedDate, minutesToTime, resolveDayBusinessMinutes, weekdayOfDateKey } from "@/lib/businessHours";
import { isBeyondBookingWindow, LEGACY_GUEST_WINDOW_DAYS } from "@/lib/bookingWindow";
import BookingQuestionFields from "@/components/booking/BookingQuestionFields";
import {
  buildAnswerSnapshot,
  missingRequiredQuestions,
  type BookingQuestion,
} from "@/lib/bookingQuestions";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Clock, Check, User, CalendarPlus, Sparkles, JapaneseYen } from "lucide-react";
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
import { LEGACY_DEFAULT_TENANT_ID } from "@/lib/legacyDefaultTenant";
import { TRIAL_BOOKING_ENABLED } from "@/lib/featureFlags";
import { hasTrialPrice, formatYen } from "@/lib/trialPricing";

interface TrialSlotBooking {
  date: string;
  startTime: string;
  endTime: string;
  /** ブロック枠（休憩・臨時休業）か。ブロックは同時受入数に関係なく店全体を塞ぐ。 */
  isBlock: boolean;
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
  /** 体験の料金（税込・円）。null は「料金を表示しない」で、0（無料と明示）とは別。 */
  trial_price_yen: number | null;
  /** 予約と予約の間に必ず空ける時間（分）。null/未設定は既定15分。 */
  booking_buffer_minutes: number | null;
  /** 1セッションの長さ（分）。null/未設定は既定60分。 */
  slot_duration_minutes: number | null;
  /** 営業時間。get_tenant_public が返す（2026-08-15 追加）。null/未設定は既定 10:00-21:00。 */
  operating_hours: { start?: string | null; end?: string | null } | null;
  /** 同時に受けられる予約数（ベッド数・施術者数）。null/未設定は既定1。 */
  booking_capacity: number | null;
  /** 予約の締切種別（'prev_day' / 'hours_before'）。null/未設定は prev_day。 */
  booking_cutoff_type: string | null;
  /** hours_before のときの時間数。null/未設定は 24。 */
  booking_cutoff_hours: number | null;
  /** 何日先まで受け付けるか。null/未設定は従来どおり10日先まで。 */
  booking_window_days: number | null;
}

// テナント指定なしの場合の既定テナント。既存リンク互換のためのレガシーシムで、
// 撤去手順は legacyDefaultTenant.ts のコメントを参照。
const DEFAULT_TENANT_ID = LEGACY_DEFAULT_TENANT_ID;


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
  // 店が設定した事前アンケート。未ログインなので RPC 経由で読む
  // （booking_questions テーブルに anon の口は開けていない）。
  const [questions, setQuestions] = useState<BookingQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missingAnswerIds, setMissingAnswerIds] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      if (!TRIAL_BOOKING_ENABLED) return;
      // テナント指定なしの /trial は既定テナント（Salute御所南）にフォールバックする。
      // 既定テナントを持たない兄弟アプリでは null になるので、RPC自体を呼ばない。
      const resolveId = tenantId || DEFAULT_TENANT_ID;
      if (!resolveId) return;
      const { data, error } = await supabase.rpc("get_tenant_public", { p_id: resolveId });
      if (error) { console.error("Failed to load tenant:", error); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setTenant(row as PublicTenant);

      // 事前アンケート。読めなくても予約自体は続けられるようにする
      // （質問が読めないせいで予約できなくなるほうが実害が大きい）。
      const { data: qs, error: qErr } = await supabase.rpc("get_tenant_booking_questions", {
        p_tenant_id: resolveId,
      });
      if (qErr || !Array.isArray(qs)) return;
      setQuestions(
        qs.map((q) => ({
          id: String(q.id),
          label: String(q.label ?? ""),
          help_text: q.help_text ?? null,
          input_type: String(q.input_type ?? "text"),
          options: Array.isArray(q.options) ? (q.options as string[]) : null,
          required: q.required === true,
          sort_order: typeof q.sort_order === "number" ? q.sort_order : 0,
          is_active: true,
          ask_on_member: false,
          ask_on_trial: true,
        })),
      );
    })();
  }, [tenantId]);

  const effectiveTenantId = tenantId || tenant?.id || DEFAULT_TENANT_ID;

  // ページ見出し。
  //
  // 2026-08-08 まで、既定テナント（Salute御所南）だけ「初回無料体験」という専用ラベルを
  // 出していた。Salute が体験を有料に切り替えたので、**その分岐ごと廃止した。**
  // 「体験トレーニング」は料金を語らない呼称なので、全ジム共通で問題ない。
  //
  // ⚠️ 料金はジムごとに違う。**呼称に料金を含めないこと**（「無料体験」に戻さない）。
  //    金額は tenants.trial_price_yen を出す。
  const headerTitle = t("trialBooking.headerTitle");

  // テナント限定の埋まり枠を60日分まとめて1回で取得する (get_tenant_booked_slots)
  const fetchExistingSlots = useCallback(async () => {
    if (!TRIAL_BOOKING_ENABLED || !effectiveTenantId) return;
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
        isBlock: r.status === "ブロック済み",
      });
    });
    setExistingBookings(slots);
  }, [effectiveTenantId]);

  useEffect(() => {
    fetchExistingSlots();
  }, [fetchExistingSlots]);

  const dateKey = selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";

  // ジムごとに変更可能（tenants.booking_buffer_minutes）。未ロード時のみ既定15分。
  const bookingBufferMinutes = tenant?.booking_buffer_minutes ?? 15;
  // ジムごとに変更可能（tenants.slot_duration_minutes）。未ロード時のみ既定60分。
  const sessionMinutes = tenant?.slot_duration_minutes ?? 60;
  // その日にまだ取れる枠があるかの判定に使う、最後の開始時刻（以前は 1260 が直書き）。
  // 曜日別の営業時間を持てるので**日付ごとに変わる**（定休日は 0＝取れる枠が無い）。
  const lastBookableStartOn = (date: string): number => {
    const day = resolveDayBusinessMinutes(tenant?.operating_hours, weekdayOfDateKey(date));
    if (!day) return 0;
    return day.close - sessionMinutes;
  };
  // 同時に受けられる予約数。未ロード時は安全側の1。
  const bookingCapacity = Math.max(tenant?.booking_capacity ?? 1, 1);

  const isSlotBlocked = (date: string, time: string): boolean => {
    const timeToMin = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return h * 60 + m;
    };
    const newMin = timeToMin(time);
    const newEnd = newMin + sessionMinutes + bookingBufferMinutes;
    const overlapping = existingBookings.filter((b) => {
      if (b.date !== date) return false;
      const bMin = timeToMin(b.startTime);
      // get_tenant_booked_slots の end_booking_date は既にテナントのバッファ込みで計算済み
      // なので、ここで更に足さない（CustomerBooking.isSlotBlocked と同一ロジック）。
      const bEnd = timeToMin(b.endTime);
      return newMin < bEnd && bMin < newEnd;
    });
    // ブロック枠は空きベッド数に関係なく店全体を塞ぐ。それ以外は同時受入数で判定。
    if (overlapping.some((b) => b.isBlock)) return true;
    return overlapping.length >= bookingCapacity;
  };

  // 体験予約の締切は会員予約と同じ「前日まで」。予約日の0:00 JST を過ぎたら（＝当日以降）締切。
  // 「満枠(予約済み)」とは別概念なので、表示側でラベルを出し分ける。
  // 締切はジム設定（tenants.booking_cutoff_*）に従う。読めなければ prev_day（従来の挙動）。
  // ⚠️ 公開ページは get_tenant_public 経由なので、この2列を返す migration が
  // 本番DBに適用されるまでは undefined になり、prev_day のままになる（安全側）。
  const cutoff = { type: tenant?.booking_cutoff_type, hours: tenant?.booking_cutoff_hours };

  const generateSlots = () => {
    const slots: { id: string; time: string; available: boolean; blocked: boolean; tooSoon: boolean }[] = [];
    // 締切は日単位（当日以降は全枠締切）。カレンダー側で当日以降は選べないため通常は発生しないが、
    // 日付選択後に日付が変わった場合の保険として枠側でも判定する。
    // 営業時間から作る（以前は 600→1260＝10:00-21:00 が直書きされていて、
    // ジムが何時まで営業していても 21:00 で止まっていた）。
    for (const totalMin of bookingSlotMinutes(tenant?.operating_hours, sessionMinutes, weekdayOfDateKey(dateKey))) {
      const time = minutesToTime(totalMin);
      // hours_before は枠の開始時刻が基準なので、枠ごとに判定する
      const tooSoon = isSlotPastCutoff(dateKey, time, cutoff);
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

    // 事前アンケートの必須項目。空のまま送らせない。
    const missing = missingRequiredQuestions(questions, answers);
    if (missing.length > 0) {
      setMissingAnswerIds(missing.map((q) => q.id));
      toast.error(t("bookingQuestions.errorRequired", { label: missing[0].label }));
      return;
    }
    setMissingAnswerIds([]);

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
          custom_answers: buildAnswerSnapshot(questions, answers),
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
    const endMin = h * 60 + m + sessionMinutes;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    setCompletedInfo({
      date: format(selectedDate, "M月d日（E）", { locale: ja }),
      time: `${slot.time}〜${endTime}`,
      rawDate: dateKey,
      rawStartTime: slot.time,
      rawEndTime: endTime,
    });
    setCompleted(true);
    // 回答は完了画面に移る前に消す（同じ端末で続けて予約されたときに持ち越さない）。
    setAnswers({});
    setMissingAnswerIds([]);
    setSubmitting(false);
  };

  if (!TRIAL_BOOKING_ENABLED) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-3">
            <h1 className="text-lg font-bold">{t("trialBooking.notAvailableTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("trialBooking.notAvailableBody")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // URL にテナントIDが無く、既定テナントも持たない（＝既定テナントを持たない兄弟アプリ）
  // 場合は予約できない。送信時にもサーバー手前で弾いているが（fetchExistingSlots 等の
  // effectiveTenantId ガード）、入力させてから失敗させるのは不親切なので最初から
  // 「リンクが正しくありません」を出す。既定テナントを持つ製品（DEFAULT_TENANT_ID !== null）
  // では発生しない。
  if (!effectiveTenantId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("trialBooking.errInvalidLink")}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          <h1 className="text-xl font-bold">{headerTitle}</h1>
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

        {/* 体験の料金。ジムが設定したときだけ出す。
            hasTrialPrice を通すのは **0 と未設定を区別する**ため（`!price` だと 0 が落ちる）。
            「当日入会で無料」のような条件は金額欄では表現しきれないので、
            上の案内カード（trial_info_body・ジムが編集できる）に書いてもらう。 */}
        {hasTrialPrice(tenant?.trial_price_yen) && (
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <span className="text-sm font-medium flex items-center gap-1.5">
                <JapaneseYen className="w-4 h-4 text-muted-foreground" />
                {t("trialBooking.priceLabel")}
              </span>
              <span className="text-base font-bold tabular-nums">
                {formatYen(tenant.trial_price_yen)}
                <span className="text-xs font-normal text-muted-foreground ml-0.5">
                  {t("trialBooking.taxIncluded")}
                </span>
              </span>
            </CardContent>
          </Card>
        )}

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
                  if (isDayPastCutoff(yyyyMMdd, cutoff, Date.now(), lastBookableStartOn(yyyyMMdd))) return true;
                  // 定休日（曜日別の営業時間で閉めている日）。
                  if (isClosedDate(tenant?.operating_hours, yyyyMMdd)) return true;
                  // 何日先まで受けるか。店が未設定なら従来どおり10日先まで。
                  return isBeyondBookingWindow(
                    yyyyMMdd, tenant?.booking_window_days ?? null, { days: LEGACY_GUEST_WINDOW_DAYS },
                  );
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
                        const end = hh * 60 + mm + sessionMinutes;
                        return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
                      })()}
                    </span>
                    {t("booking.slotMinutes", { count: sessionMinutes })}
                  </p>
                  {questions.length > 0 && (
                    <div className="mb-3 text-left rounded-xl bg-background/60 p-3">
                      <p className="text-[11px] font-bold text-muted-foreground mb-2">
                        {t("bookingQuestions.sectionTitle")}
                      </p>
                      <BookingQuestionFields
                        questions={questions}
                        values={answers}
                        onChange={(id, value) => setAnswers((prev) => ({ ...prev, [id]: value }))}
                        missingIds={missingAnswerIds}
                        requiredLabel={t("bookingQuestions.required")}
                        checkedValue={t("bookingQuestions.checked")}
                        disabled={submitting}
                      />
                    </div>
                  )}
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
