import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, Clock, Check, Trash2, CalendarPlus, Swords, Info, Repeat, CalendarClock, X, Phone, MessageCircle, MessageSquare, UserRound, ClipboardList } from "lucide-react";
import { openExternalUrl } from "@/lib/nativeBridge";
import { sendLineMessage } from "@/lib/lineNotify";
import { buildGoogleCalendarUrl } from "@/lib/googleCalendar";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyBookings, createBooking, createRecurringBookings, cancelBooking, rescheduleBooking, BookingWithTime, SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { format, startOfDay } from "date-fns";
import { ja } from "date-fns/locale";
import { toast } from "sonner";
import { trialLabel } from "@/lib/dummyData";
import { sendBookingNotifications } from "@/lib/bookingNotification";
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
import { resolvePlanSlotMinutes } from "@/lib/planSlotDuration";
import { isClosedDate, minutesToTime, parseTimeToMinutes, resolveDayBusinessMinutes, weekdayOfDateKey } from "@/lib/businessHours";
import { isSlotPastCutoff, isDayPastCutoff } from "@/lib/bookingCutoff";
import { bookingWindowEnd, isBeyondBookingWindow, LEGACY_MEMBER_WINDOW_MONTHS } from "@/lib/bookingWindow";
import { useTenantStaff } from "@/hooks/useTenantStaff";
import { useStaffSchedules } from "@/hooks/useStaffSchedules";
import { useBookingFrequencyLimits } from "@/hooks/useBookingFrequencyLimits";
import { useBookingCapacityWindows } from "@/hooks/useBookingCapacityWindows";
import { useBookingBlockedWindows } from "@/hooks/useBookingBlockedWindows";
import { resolveSlotCapacity } from "@/lib/bookingCapacity";
import { computePlanUsage, resolvePlanUsageInput } from "@/lib/planUsage";
import { isPlanLimitError, isPlanSessionLimitReached } from "@/lib/planSessionLimit";
import { exceededFrequencyLimit, isBookingLimitError, isExemptFromFrequencyLimits } from "@/lib/bookingLimits";
import { isBlockedStart, isBlockedWindowError } from "@/lib/bookingBlockedWindows";
import { useBookingQuestions } from "@/hooks/useBookingQuestions";
import BookingQuestionFields from "@/components/booking/BookingQuestionFields";
import {
  buildAnswerSnapshot,
  missingRequiredQuestions,
  questionsForSurface,
} from "@/lib/bookingQuestions";
import {
  isStaffOffShiftError,
  staffBookingSlotMinutes,
  staffWorksOnWeekday,
} from "@/lib/staffSchedule";
import { canSelectStaff, isStaffConflictError } from "@/lib/tenantStaff";
import { BRAND_FALLBACK_GYM_NAME } from "@/lib/brand";

// セッション長・バッファはどちらもジムごとに変更可能（tenants.slot_duration_minutes /
// tenants.booking_buffer_minutes）。未設定/未ロード時のみこの既定値を使う。
const DEFAULT_BOOKING_BUFFER_MINUTES = 15;

const CustomerBooking = ({ onOpenChat }: { onOpenChat?: () => void }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile, loading: profileLoading, refetch: refetchProfile } = useProfile();
  const { bookings: myBookings, loading: bookingsLoading, refetch } = useMyBookings();
  // 🔴 allPlans（非公開も含む）を使う。プランを非公開にしても既存会員の契約は
  // その行のまま生きていて、DB 側は is_active を見ずに plan_name で引く。
  // 有効行だけで解決すると、その会員だけ回数・サイクル・上限設定を見失い、
  // 「カードは残りありなのに GB004 で拒否され続ける」になる。
  // お客様の画面にプランの選択肢は無いので、この画面は全部 allPlans でよい。
  const { tenant, allPlans: tenantPlans } = useTenant();
  // 担当スタッフ。2人以上いるジムでだけ選択UIを出す（一人ジムには無用な一手になる）。
  const { staff } = useTenantStaff();
  const staffSelectable = canSelectStaff(staff);
  // スタッフのシフト。読めなければ空＝「全員シフト未設定」＝営業時間どおり（従来の挙動）。
  const { schedules: staffSchedules } = useStaffSchedules();
  // 予約時のカスタム質問（事前アンケート）。
  const { questions: allQuestions } = useBookingQuestions();
  // 予約回数の制限（例: 平日18-19時は週1回まで）。読めなければ空＝制限なし。
  const { limits: frequencyLimits } = useBookingFrequencyLimits();
  // 時間帯別の同時受け入れ数。読めなければ空＝店の既定値（従来どおり）。
  const { windows: capacityWindows } = useBookingCapacityWindows();
  const { windows: blockedWindows } = useBookingBlockedWindows();

  // ご契約プランの回数上限（例: 月8回）。**カードが出しているのと同じ数**で判定する
  // （別に数え直すと「残1回と出ているのに拒否される」が起きうる）。
  // allow_overflow が既定(true)のプランでは常に false ＝ 従来どおり超過できる。
  const currentTenantPlan = tenantPlans?.find((p) => p.plan_name === profile?.plan) ?? null;
  const planUsageInput = useMemo(() => {
    const input = resolvePlanUsageInput(profile?.plan, currentTenantPlan, profile?.cycle_start_date);
    if (input && profile?.grace_enabled === false) input.graceDays = 0;
    return input;
  }, [profile?.plan, profile?.cycle_start_date, profile?.grace_enabled, currentTenantPlan]);
  const planBookingsForUsage = useMemo(
    () => myBookings.map((b) => ({ booking_date: `${b.date}T${b.startTime}:00+09:00`, status: b.status })),
    [myBookings],
  );
  // カード表示用は「今日」基準（今の期間の消化状況を出す。従来どおり）
  const planUsage = useMemo(
    () => (planUsageInput ? computePlanUsage(planUsageInput, planBookingsForUsage, getJSTNow()) : null),
    [planUsageInput, planBookingsForUsage],
  );
  // 🔴 判定は「**予約しようとしている日**」の属するサイクルで行う。
  // DB（guard_booking_plan_limit）は予約日の窓で数えるので、「今日」基準にすると
  // 今サイクルを使い切ったお客様が、DB なら通る**次サイクルの日付**まで
  // 画面で塞がれてしまう（応当日が来るまで一切予約できなくなる）。
  // allow_overflow=false ではロールが止まっているので、予約日を渡せば
  // plan_cycle_window と同じ暦窓・同じ数になる。
  const isPlanLimitReachedOn = useCallback(
    (targetDateKey: string | null | undefined): boolean => {
      if (!planUsageInput || !targetDateKey) return false;
      const usage = computePlanUsage(
        planUsageInput,
        planBookingsForUsage,
        toJSTDate(`${targetDateKey}T00:00:00+09:00`),
      );
      return isPlanSessionLimitReached(usage, currentTenantPlan?.allow_overflow, currentTenantPlan?.plan_type);
    },
    [planUsageInput, planBookingsForUsage, currentTenantPlan?.allow_overflow, currentTenantPlan?.plan_type],
  );

  // Build plan name → label / max sessions maps from tenant_plans
  const planLabelMap = useMemo(() => {
    // キー（予約種別の内部値）は "初回無料体験" のまま、表示ラベルだけ "体験予約" にする
    const m: Record<string, string> = { "初回無料体験": "体験予約" };
    tenantPlans?.forEach((p) => { m[p.plan_name] = p.plan_name; });
    return m;
  }, [tenantPlans]);

  // 営業時間は src/lib/businessHours.ts が唯一の解釈者。
  // 以前はここで `"22:30".split(":")[0]` として**分を捨てていた**（22:00 扱いになる）。
  const businessHours = tenant?.operating_hours;
  // お客様ごとに契約プラン（profile.plan）は1つだけなので、この画面全体を通じて
  // 「このお客様の予約が占有する時間」はプランごとの設定を解決した1つの値でよい
  // （プランに未設定ならジムの既定値を継承。resolvePlanSlotMinutes 参照）。
  const slotMinutes = resolvePlanSlotMinutes(profile?.plan, tenantPlans, tenant?.slot_duration_minutes ?? 60);
  // 何日先まで受け付けるか。null=未設定なら従来どおり「1ヶ月先まで」。
  const bookingWindowDays = tenant?.booking_window_days ?? null;
  const maxBookableDate = bookingWindowEnd(bookingWindowDays, { months: LEGACY_MEMBER_WINDOW_MONTHS });
  // 会員の予約で聞く質問だけ（体験専用の質問は出さない）。
  const memberQuestions = useMemo(() => questionsForSurface(allQuestions, "member"), [allQuestions]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missingAnswerIds, setMissingAnswerIds] = useState<string[]>([]);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  // 担当スタッフの指名。null＝指名なし（誰でもよい）。既定は指名なし。
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
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
  const [bookedSlots, setBookedSlots] = useState<{ date: string; startTime: string; endTime: string; isBlock: boolean; staffUserId: string | null }[]>([]);

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
    const slots = (data as { booking_date: string; end_booking_date: string; status: string; staff_user_id: string | null }[])
      .filter((r) => r.status !== "キャンセル済み")
      .map((r) => {
        const dt = toJSTDate(r.booking_date);
        const endDt = toJSTDate(r.end_booking_date);
        return {
          date: format(dt, "yyyy-MM-dd"),
          startTime: `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`,
          endTime: `${String(endDt.getHours()).padStart(2, "0")}:${String(endDt.getMinutes()).padStart(2, "0")}`,
          isBlock: r.status === "ブロック済み",
          staffUserId: r.staff_user_id ?? null,
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
  // 同時に受けられる予約数（ベッド数・施術者数）。未ロード時は安全側の1。
  // 店の既定の同時受入数。時間帯の帯がある枠では、下の isSlotBlocked が帯の値で上書きする。
  const bookingCapacity = Math.max(tenant?.booking_capacity ?? 1, 1);

  const isSlotBlocked = (date: string, time: string): boolean => {
    const timeToMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const newMin = timeToMin(time);
    const newEnd = newMin + slotMinutes + bookingBufferMinutes;
    // Bookings occupy the gym's configured session length (既定60分) plus the gym's
    // configured buffer (既定15分). Apply the same footprint to both existing bookings
    // and the candidate so the buffer is enforced
    // before and after every booking.
    const overlapping = bookedSlots.filter((b) => {
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
    // ブロック枠は空きベッド数に関係なく店全体を塞ぐ。それ以外は同時受入数で判定する。
    if (overlapping.some((b) => b.isBlock)) return true;
    // 同時受入数は時間帯で変わりうる（昼は2人・夜は1人など）。帯が無ければ店の既定値。
    const capacityHere = resolveSlotCapacity(
      capacityWindows, weekdayOfDateKey(date), newMin, bookingCapacity,
    );
    if (overlapping.length >= capacityHere) return true;
    // 店に空きがあっても、指名した担当がその時間帯に別の予約を持っていれば取れない。
    // 指名なし（selectedStaffId === null）のときはこの判定を通らない＝従来どおり。
    // DB 側 check_booking_overlap も同じ二段構えで最終判定する。
    return !!selectedStaffId && overlapping.some((b) => b.staffUserId === selectedStaffId);
  };

  // 締切はジム設定（tenants.booking_cutoff_*）に従う。読めなければ prev_day（従来の挙動）。
  const cutoff = { type: tenant?.booking_cutoff_type, hours: tenant?.booking_cutoff_hours };

  // 過去日（今日より前）か。カレンダーで選択不可にする対象。
  const isPastDay = (date: string): boolean => !!date && date < getJSTToday();
  // その日にまだ取れる枠があるかの判定に使う「最後に予約できる開始時刻」。
  // 曜日別の営業時間があるので**日付ごとに変わる**（定休日は取れる枠が無い＝0扱い）。
  const lastBookableStartOn = (date: string): number => {
    const day = resolveDayBusinessMinutes(businessHours, weekdayOfDateKey(date));
    if (!day) return 0;
    return day.close - slotMinutes;
  };

  // 今日(JST)で、かつ締切を過ぎていて1枠も取れない日か。「空き状況の閲覧のみ」の案内を出す対象。
  // hours_before の店では当日でも取れる枠が残るので、その場合は案内を出さない。
  const isViewOnlyDay = (date: string): boolean =>
    !!date && date === getJSTToday() && isDayPastCutoff(date, cutoff, Date.now(), lastBookableStartOn(date));

  // このテナントで同日キャンセル消化が有効、かつ「変更対象の予約」が今日(JST)の分か。
  // 当日の枠を手放す変更なので、当日キャンセルと同じく消化扱いにする。
  // ⚠️ isSlotOverLimit（下）が参照するので、必ずこの位置（generateSlots より前）に置くこと。
  const rescheduleTargetForfeits = !!rescheduleTarget
    && !!tenant?.same_day_cancel_penalty_enabled
    && rescheduleTarget.date === getJSTToday();

  // 予約回数の制限（例: 平日18-19時は週1回まで）に、この枠を取ると達するか。
  // 数える元は自分の予約一覧（myBookings）。最終判定は DB（GB003）。
  //
  // リスケ中の除外は経路で変える（DB と同じ答えになるように）:
  //   非消化リスケ … 旧行は物理削除されてから新枠が INSERT される → 旧枠は数えない（除外）
  //   消化リスケ   … 旧行は「同日キャンセル済み」で残り、DB はそれを数える → 除外しない。
  //                  除外すると UI が「空き」と見せた枠が必ず GB003 で拒否される
  const isSlotOverLimit = (date: string, time: string): boolean => {
    if (!user || frequencyLimits.length === 0) return false;
    const startMinutes = parseTimeToMinutes(time);
    if (startMinutes === null) return false;
    return !!exceededFrequencyLimit(
      frequencyLimits,
      { dateKey: date, startMinutes, userId: user.id },
      myBookings,
      rescheduleTargetForfeits ? null : (rescheduleTarget?.id ?? null),
    );
  };

  // 受付しない時間帯（booking_blocked_windows）。帯は**両端を含まない**
  // （両端＝残したい2枠そのもの）。免除（制限の exempt 行）はこの帯より強い。
  // 最終判定は DB のトリガー（GB006）。
  const isSlotNotAccepting = (date: string, time: string): boolean => {
    if (!user || blockedWindows.length === 0) return false;
    const weekday = weekdayOfDateKey(date);
    const startMinutes = parseTimeToMinutes(time);
    if (weekday === null || startMinutes === null) return false;
    if (isExemptFromFrequencyLimits(frequencyLimits, weekday, startMinutes, user.id)) return false;
    return isBlockedStart(blockedWindows, weekday, startMinutes);
  };

  const generateSlots = () => {
    const slots: { id: string; time: string; available: boolean; blocked: boolean; tooSoon: boolean; overLimit: boolean; notAccepting: boolean }[] = [];
    // 曜日別の営業時間・定休日、さらに指名した担当のシフトまで反映する。
    // 指名なし／シフト未設定なら、結果は店の営業時間そのもの（従来どおり）。
    const weekday = weekdayOfDateKey(dateKey);
    for (const totalMin of staffBookingSlotMinutes(
      businessHours, slotMinutes, weekday, staffSchedules, selectedStaffId,
    )) {
      const time = minutesToTime(totalMin);
      const blocked = isSlotBlocked(dateKey, time);
      const tooSoon = isSlotPastCutoff(dateKey, time, cutoff);
      const overLimit = isSlotOverLimit(dateKey, time);
      const notAccepting = isSlotNotAccepting(dateKey, time);
      slots.push({
        id: `${dateKey}-${time}`, time,
        available: !blocked && !tooSoon && !overLimit && !notAccepting,
        blocked, tooSoon, overLimit, notAccepting,
      });
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

    if (isSlotPastCutoff(dateKey, slot.time, cutoff)) {
      toast.error(t("booking.errorAdvance"));
      setSelectedSlot(null);
      return;
    }

    if (isSlotBlocked(dateKey, slot.time)) {
      toast.error(t("booking.errorSlotTaken"));
      setSelectedSlot(null);
      return;
    }

    // 予約回数の制限。枠は押せない表示にしてあるが、他の端末で予約した直後などの
    // ずれに備えて送信直前にも見る（最終判定は DB のトリガー = GB003）。
    if (isSlotOverLimit(dateKey, slot.time)) {
      toast.error(t("bookingLimits.errorOverLimit"));
      setSelectedSlot(null);
      return;
    }

    // 受付しない時間帯（最終判定は DB = GB006）
    if (isSlotNotAccepting(dateKey, slot.time)) {
      toast.error(t("blockedWindows.errorNotAccepting"));
      setSelectedSlot(null);
      return;
    }

    // ご契約プランの回数上限（超過を許さないプランのみ）。最終判定は DB（GB004）。
    // 予約日の属するサイクルで判定する（次サイクルの日付は DB 同様に通す）。
    if (isPlanLimitReachedOn(dateKey)) {
      toast.error(t("planSessions.errorReached"));
      return;
    }

    // 事前アンケートの必須項目。空のまま送らせない（DB は必須を強制しないので、
    // ここが唯一の関門。店が「必須」にした意味を守る）。
    const missing = missingRequiredQuestions(memberQuestions, answers);
    if (missing.length > 0) {
      setMissingAnswerIds(missing.map((q) => q.id));
      toast.error(t("bookingQuestions.errorRequired", { label: missing[0].label }));
      return;
    }
    setMissingAnswerIds([]);
    const answerSnapshot = buildAnswerSnapshot(memberQuestions, answers);

    setSubmitting(true);

    // 定期予約: repeatWeeks > 1 なら毎週同じ曜日・時間でまとめて作成。
    // 満枠の週はスキップされる（結果はトーストで通知）。
    // 念のため、予約可能期間（1ヶ月先まで）を超える回数が紛れ込んでいないか送信直前にも
    // 絞り込む（UI側の自動絞り込みと合わせた二重防御。日付選択後に日をまたいだ等のケース向け）。
    const effectiveRepeatWeeks = Math.min(repeatWeeks, maxRepeatWeeksFor(selectedDate, maxBookableDate));
    // 作成できた予約は全件保持する。メールは1件ずつ送るため、ここで取りこぼすと
    // 定期予約の2回目以降に受付メールが届かなくなる（実際にそうなっていた）。
    let createdBookings: { id: string; date: string }[];
    if (effectiveRepeatWeeks > 1) {
      const { booked, skipped } = await createRecurringBookings(
        user.id, dateKey, slot.time, selectedPlan, effectiveRepeatWeeks, false, selectedStaffId, answerSnapshot,
      );
      if (booked.length === 0) {
        // 全週スキップ。全部が回数上限（GB003）／プラン上限（GB004）なら満枠ではない
        // ので文言を分ける（空き待ちしても取れないことを伝える）。
        toast.error(
          skipped.every((sk) => isPlanLimitError({ code: sk.code }))
            ? t("planSessions.errorReached")
            : skipped.every((sk) => isBlockedWindowError({ code: sk.code }))
              ? t("blockedWindows.errorNotAccepting")
            : skipped.every((sk) => isBookingLimitError({ code: sk.code }))
              ? t("bookingLimits.errorOverLimit")
              : t("booking.errorBookingFailed"),
        );
        setSubmitting(false);
        return;
      }
      createdBookings = booked;
      toast.success(t("booking.repeatResult", { count: booked.length }));
      // スキップ理由で案内を分ける: 満枠（空き待ちすれば取れる）・時間帯の回数上限
      // （待っても自分は取れない）・プランの回数上限（今サイクルはもう取れない）は
      // それぞれ別の話。GB004 を「満枠」と案内すると、空き待ちに登録して待ち続けて
      // しまう（絶対に取れないのに）。
      const fmtDates = (list: { date: string }[]) =>
        list.map((sk) => formatJST(`${sk.date}T00:00:00+09:00`, "M/d", { locale: ja })).join("、");
      const planSkipped = skipped.filter((sk) => isPlanLimitError({ code: sk.code }));
      const limitSkipped = skipped.filter((sk) => isBookingLimitError({ code: sk.code }));
      const blockSkipped = skipped.filter((sk) => isBlockedWindowError({ code: sk.code }));
      const otherSkipped = skipped.filter(
        (sk) => !isBookingLimitError({ code: sk.code }) && !isPlanLimitError({ code: sk.code })
          && !isBlockedWindowError({ code: sk.code }),
      );
      if (otherSkipped.length > 0) {
        toast.info(t("booking.repeatSkipped", { count: otherSkipped.length, dates: fmtDates(otherSkipped) }));
      }
      if (limitSkipped.length > 0) {
        toast.info(t("bookingLimits.repeatSkippedLimit", { count: limitSkipped.length, dates: fmtDates(limitSkipped) }));
      }
      if (planSkipped.length > 0) {
        toast.info(t("planSessions.repeatSkippedPlan", { count: planSkipped.length, dates: fmtDates(planSkipped) }));
      }
      if (blockSkipped.length > 0) {
        toast.info(t("blockedWindows.repeatSkippedBlocked", { count: blockSkipped.length, dates: fmtDates(blockSkipped) }));
      }
    } else {
      const { data, error } = await createBooking(
        user.id, dateKey, slot.time, selectedPlan, false,
        { staffUserId: selectedStaffId, customAnswers: answerSnapshot },
      );
      if (error) {
        // 店には空きがあるのに担当だけ埋まっている場合は、別の担当なら取れると案内する。
        // シフト外（GB002）は「別の時間」ではなく「別の担当か別の曜日」なので文言を分ける。
        toast.error(
          isPlanLimitError(error) ? t("planSessions.errorReached")
            : isBlockedWindowError(error) ? t("blockedWindows.errorNotAccepting")
            : isBookingLimitError(error) ? t("bookingLimits.errorOverLimit")
            : isStaffOffShiftError(error) ? t("staff.errorStaffOffShift")
            : isStaffConflictError(error) ? t("staff.errorStaffBusy")
            : t("booking.errorBookingFailed"),
        );
        setSubmitting(false);
        return;
      }
      createdBookings = [{ id: data.id, date: dateKey }];
    }
    const firstBooking = createdBookings[0];

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
    // 事前アンケートの回答は**必ず消す**。「本日の体調」のような質問は予約ごとに
    // 聞き直す前提なので、残すと2件目に前回の回答が黙って付いてくる。
    setAnswers({});
    setMissingAnswerIds([]);
    // plan is auto-assigned, no need to reset
    setSubmitting(false);
    refetch();
    refetchProfile(); // 1回目の予約で起算日が自動設定された場合に利用期間カードを更新
    fetchBookedSlots(dateKey);

    // この枠のキャンセル待ちに入っていたら解除する（予約できたため不要）
    if (WAITLIST_ENABLED) {
      supabase
        .from("booking_waitlist")
        .delete()
        .eq("user_id", user.id)
        .eq("booking_date", dateKey)
        .eq("start_time", slot.time)
        .then(() => refreshWaitlist());
    }

    // Fire-and-forget notification email to trainer + confirmation to customer.
    // 定期予約では作成できた全件を渡す（1件目だけ渡すと2回目以降にメールが届かない）。
    sendBookingNotifications(createdBookings, profile?.display_name || t("booking.customerFallback"), slot.time, endTime, selectedPlan, user.id, user.email, tenant?.booking_email_note ?? null);

    // Fire-and-forget LINE message to customer
    // Gated by feature flag — customer LINE booking notifications are currently disabled
    // (only the trainer reminder/notification flows remain). Set to true to revive.
    const NOTIFY_CUSTOMER_LINE_ON_BOOKING = false;
    if (NOTIFY_CUSTOMER_LINE_ON_BOOKING) {
      void sendLineMessage({
        user_id: user.id,
        message: `✅ 予約確定\n\n${format(selectedDate!, "M/d", { locale: ja })}（${format(selectedDate!, "E", { locale: ja })}）${slot.time}\n\n${profile?.display_name || "お客"}様、トレーニングのご予約が完了しました。\n\nプラン：${selectedPlan}\n\n${tenant?.gym_name || BRAND_FALLBACK_GYM_NAME}`,
      }, "顧客へ予約確定通知");
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
    // 変更しても担当は引き継がれる（rescheduleBooking が元の担当を渡す）。
    // 空き枠の表示もその担当基準にしないと、実際には取れない枠を「空き」と見せてしまう。
    setSelectedStaffId(b.staff_user_id ?? null);
    setRepeatWeeks(1);
    setTimeout(() => document.getElementById("calendar-section")?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const cancelReschedule = () => {
    setRescheduleTarget(null);
    setRescheduleForfeitPending(false);
    setSelectedDate(undefined);
    setSelectedSlot(null);
  };

  // 選択した新しい日時へ予約を変更する（旧枠削除→新枠作成、失敗時は旧枠復元）。
  // 当日の変更でジム設定ONのときは、旧枠を消化扱いにして残す（forfeitOld）。
  const handleReschedule = async () => {
    if (!rescheduleTarget || submitting) return;
    if (!selectedDate || !selectedSlot) return;
    const slot = slots.find((s) => s.id === selectedSlot);
    if (!slot) return;
    if (isSlotPastCutoff(dateKey, slot.time, cutoff)) {
      toast.error(t("booking.errorAdvance"));
      setSelectedSlot(null);
      return;
    }
    if (isSlotBlocked(dateKey, slot.time)) {
      toast.error(t("booking.errorSlotTaken"));
      setSelectedSlot(null);
      return;
    }
    // 予約回数の制限。空いている時間で取ってからピーク帯へ動かす抜け道を塞ぐ
    // （動かしている予約自体は isSlotOverLimit が除外して数える）。
    if (isSlotOverLimit(dateKey, slot.time)) {
      toast.error(t("bookingLimits.errorOverLimit"));
      setSelectedSlot(null);
      return;
    }
    // 受付しない時間帯への移動も塞ぐ（最終判定は DB = GB006）
    if (isSlotNotAccepting(dateKey, slot.time)) {
      toast.error(t("blockedWindows.errorNotAccepting"));
      setSelectedSlot(null);
      return;
    }
    // 消化リスケは旧行が「同日キャンセル済み」で残って回数に数えられ続けるため、
    // 上限ちょうどのお客様は**構造的に必ず GB004 で失敗する**。押させてから
    // 消化→拒否→復元の往復をさせるより、先に理由を言って止める。
    // 非消化リスケは旧行が消える（純増ゼロ）ので、ここで止めてはいけない。
    if (rescheduleTargetForfeits && isPlanLimitReachedOn(dateKey)) {
      toast.error(t("planSessions.errorRescheduleForfeitReached"));
      return;
    }
    // 当日の予約変更（消化対象）は、最初の押下では警告表示に切り替えるだけに留める。
    if (rescheduleTargetForfeits && !rescheduleForfeitPending) {
      setRescheduleForfeitPending(true);
      return;
    }
    setSubmitting(true);
    try {
      const { error, restoreFailed } = await rescheduleBooking(rescheduleTarget.id, dateKey, slot.time, { forfeitOld: rescheduleTargetForfeits });
      if (error) {
        // 復元まで失敗した場合は「変更に失敗」では足りない（元の予約が消えている）。
        // GB004 は消化リスケ（旧行が数えられ続ける）で他端末とのずれ等から到達しうる。
        toast.error(
          restoreFailed ? t("bookingLimits.errorRestoreFailed")
            : isPlanLimitError(error)
              ? (rescheduleTargetForfeits ? t("planSessions.errorRescheduleForfeitReached") : t("planSessions.errorReached"))
            : isBlockedWindowError(error) ? t("blockedWindows.errorNotAccepting")
            : isBookingLimitError(error) ? t("bookingLimits.errorOverLimit")
            : t("booking.errorRescheduleFailed"),
        );
        if (restoreFailed) refetch();
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

  // ジムが設定したキャンセルについての案内。空欄なら何も出さない（既定文は持たない）。
  const cancelPolicy = tenant?.cancel_policy_body?.trim() || "";

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
          {/* ジムが書いたキャンセルについての案内。設定していないジムには何も出さない。
              予約する前に読めるよう、キャンセル確認だけでなくここにも出す。 */}
          {cancelPolicy && (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-[11px] font-bold flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                {t("booking.cancelPolicyTitle")}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1 whitespace-pre-line">{cancelPolicy}</p>
            </div>
          )}
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

            {/* 担当の指名。スタッフが2人以上いるジムでだけ出す。
                選び直すと空き枠の見え方が変わるので、選択中の枠は解除する。 */}
            {staffSelectable && (
              <div className="mb-3">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <UserRound className="w-3.5 h-3.5" />
                  {t("staff.selectLabel")}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setSelectedStaffId(null); setSelectedSlot(null); }}
                    aria-pressed={selectedStaffId === null}
                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
                      selectedStaffId === null
                        ? "bg-accent text-accent-foreground shadow-sm"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("staff.anyone")}
                  </button>
                  {staff.map((s) => (
                    <button
                      key={s.user_id}
                      type="button"
                      onClick={() => {
                        setSelectedStaffId(s.user_id);
                        setSelectedSlot(null);
                        // その担当が選択中の日に出勤していないなら、日付ごと外す。
                        // 残しておくと「日付は選ばれているのに枠が0件」になり、
                        // 空きが無いのか担当が休みなのか区別できない。
                        if (dateKey && !staffWorksOnWeekday(businessHours, weekdayOfDateKey(dateKey), staffSchedules, s.user_id)) {
                          setSelectedDate(undefined);
                        }
                      }}
                      aria-pressed={selectedStaffId === s.user_id}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[44px] ${
                        selectedStaffId === s.user_id
                          ? "bg-accent text-accent-foreground shadow-sm"
                          : "bg-secondary text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s.display_name}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">{t("staff.selectHint")}</p>
              </div>
            )}

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
                      // 定期予約の回数が、新しく選んだ日の予約可能期間（店の設定。
                      // 未設定なら従来どおり1ヶ月先まで）に収まらなくなった場合は、
                      // 選べる上限まで自動的に絞り込む。
                      const cap = maxRepeatWeeksFor(d, maxBookableDate);
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
                  toDate={maxBookableDate}
                  disabled={(date) => {
                    const yyyyMMdd = format(date, "yyyy-MM-dd");
                    // 当日は選択可能にする。締切の判定は枠ごとに isSlotPastCutoff が行う
                    // （prev_day の店なら全枠が不可＝従来どおり「閲覧のみ」、
                    //  hours_before の店なら締切前の枠だけ予約できる）ので、
                    // ここで塞ぐのは過去日と、店が閉まっている日だけでよい。
                    if (isPastDay(yyyyMMdd)) return true;
                    // 定休日。toDate があっても、その間の定休日は個別に塞ぐ必要がある。
                    if (isClosedDate(businessHours, yyyyMMdd)) return true;
                    // 指名した担当が出勤していない曜日。指名なしなら常に false。
                    if (!staffWorksOnWeekday(businessHours, weekdayOfDateKey(yyyyMMdd), staffSchedules, selectedStaffId)) {
                      return true;
                    }
                    return isBeyondBookingWindow(yyyyMMdd, bookingWindowDays, { months: LEGACY_MEMBER_WINDOW_MONTHS });
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
                    // 回数上限の枠はキャンセル待ちの対象にもしない（空きを待っても自分は取れない）。
                    const waitlistable = WAITLIST_ENABLED && !slot.available && slot.blocked && !slot.tooSoon && !slot.overLimit && !slot.notAccepting;
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
                          {slot.notAccepting && !slot.blocked
                            ? <span className="text-muted-foreground">{t("blockedWindows.slotNotAccepting")}</span>
                            : slot.overLimit && !slot.blocked
                            ? <span className="text-muted-foreground">{t("bookingLimits.slotLimitReached")}</span>
                            : viewOnlyOpen
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
                    {/* 事前アンケート（店が設定した質問）。1つも無ければ何も出ない。
                        予約変更モードでは聞かない（元の予約の回答を引き継ぐため）。 */}
                    {!rescheduleTarget && memberQuestions.length > 0 && (
                      <div className="mb-3 text-left rounded-xl bg-background/60 p-3">
                        <p className="text-[11px] font-bold text-muted-foreground mb-2 flex items-center gap-1">
                          <ClipboardList className="w-3 h-3" />
                          {t("bookingQuestions.sectionTitle")}
                        </p>
                        <BookingQuestionFields
                          questions={memberQuestions}
                          values={answers}
                          onChange={(id, value) => setAnswers((prev) => ({ ...prev, [id]: value }))}
                          missingIds={missingAnswerIds}
                          requiredLabel={t("bookingQuestions.required")}
                          checkedValue={t("bookingQuestions.checked")}
                          disabled={submitting || (!rescheduleTarget && !!selectedDate && isPlanLimitReachedOn(format(selectedDate, "yyyy-MM-dd")))}
                        />
                      </div>
                    )}
                    {/* 定期予約: 毎週同じ曜日・時間でまとめて予約（変更モードでは非表示） */}
                    {!rescheduleTarget && selectedDate && (() => {
                      // 選択中の日から、予約可能期間（1ヶ月先まで）に収まる回数の上限
                      const repeatCap = maxRepeatWeeksFor(selectedDate, maxBookableDate);
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
              {/* ジムが書いたキャンセルについての案内。設定していないジムには何も出さない。
                  ペナルティの警告（forfeitPending）を出しているときは、そちらが優先。 */}
              {!forfeitPending && cancelPolicy && (
                <p className="text-xs text-muted-foreground whitespace-pre-line rounded-lg bg-muted/50 p-3 text-left">
                  {cancelPolicy}
                </p>
              )}
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
