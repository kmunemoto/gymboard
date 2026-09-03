import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Plus, Trash2, Ban, Repeat, Sparkles, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAllBookings, checkSlotBlocked, createBooking, createRecurringBookings, cancelBooking, SAME_DAY_FORFEIT_STATUS, type BookingWithTime } from "@/hooks/useBookings";
import { useAllCustomerProfiles } from "@/hooks/useProfile";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/hooks/useTenant";
import { blockEndMinutes, businessGridMinutes, isClosedDate, minutesToTime, parseTimeToMinutes, weekdayOfDateKey } from "@/lib/businessHours";
import { useStaffSchedules } from "@/hooks/useStaffSchedules";
import { useBookingQuestions } from "@/hooks/useBookingQuestions";
import BookingQuestionFields from "@/components/booking/BookingQuestionFields";
import BookingOptionPicker from "@/components/booking/BookingOptionPicker";
import { useBookingOptionSelection } from "@/hooks/useBookingOptionSelection";
import { sessionMinutes as withOptions } from "@/lib/bookingOptions";
import {
  buildAnswerSnapshot,
  missingRequiredQuestions,
  questionsForSurface,
} from "@/lib/bookingQuestions";
import { staffBookingSlotMinutes, staffWorksOnWeekday } from "@/lib/staffSchedule";
import { isBookingLimitError } from "@/lib/bookingLimits";
import { proxyBookingErrorKey } from "@/lib/bookingErrors";
import { useBookingCapacityWindows } from "@/hooks/useBookingCapacityWindows";
import { matchedWindowCapacity, resolveSlotCapacity } from "@/lib/bookingCapacity";
import { format, addDays, startOfWeek, isSameDay } from "date-fns";
import { ja } from "date-fns/locale";
import { formatDate } from "@/lib/dateFormat";
import { getJSTNow, getJSTToday, formatJST } from "@/lib/timezone";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import WeekTimelineView from "./WeekTimelineView";
import BookingProgressBadge from "./BookingProgressBadge";
import BookingOptionEditDialog from "./BookingOptionEditDialog";
import BookingOptionLine from "./BookingOptionLine";
import { getBookingProgressIndex, resolveCycleMonths, resolveCycleUnit, resolveGraceDays, type BookingForProgress } from "@/lib/courseProgress";
import { resolvePlanSlotMinutes } from "@/lib/planSlotDuration";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { useTenantStaff } from "@/hooks/useTenantStaff";
import { canSelectStaff, isStaffConflictError, staffNameMap } from "@/lib/tenantStaff";
import DayReceptionToggle from "./DayReceptionToggle";
import { useDayReception } from "@/hooks/useDayReception";

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
  // 代理予約の担当スタッフ（""＝指名なし）。スタッフが2人以上のジムでだけ選択欄を出す。
  const [proxyStaffId, setProxyStaffId] = useState<string>("");
  // 既存予約の担当変更ダイアログ（null＝閉じている）
  const [assignTarget, setAssignTarget] = useState<{ id: string; clientName: string; date: string; startTime: string; staffUserId: string | null } | null>(null);
  const [assignSaving, setAssignSaving] = useState(false);
  // 定期予約: 毎週同じ曜日・時間で何回分まとめて予約するか（1=この回のみ）
  const [proxyRepeatWeeks, setProxyRepeatWeeks] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; clientName: string; date: string; startTime: string; isBlocked?: boolean; recurrenceGroup?: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 同日キャンセルのペナルティが有効なジムで、対象が当日の会員予約のときだけ
  // 「消化扱いにする」を選べるチェックボックスの値（既定ON）
  const [forfeitChecked, setForfeitChecked] = useState(true);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockDate, setBlockDate] = useState<Date | undefined>();
  const [blockStartTime, setBlockStartTime] = useState<string>("");
  const [blockEndTime, setBlockEndTime] = useState<string>("");
  // くり返しブロック: 毎週同じ曜日・時間で何週ぶんまとめてブロックするか（1=この回のみ）。
  // 「毎週月曜の午後はスタジオ貸し出し」のような固定の予定を1回の操作で入れる（実店舗の要望）。
  const [blockRepeatWeeks, setBlockRepeatWeeks] = useState(1);
  // ブロック解除: 同じくり返しグループの「この日以降」もまとめて解除するか
  const [releaseSeriesChecked, setReleaseSeriesChecked] = useState(false);
  // あとからオプションを足す／外す対象（店側専用。可否の判定は DB の GB008）
  const [optionTarget, setOptionTarget] = useState<BookingWithTime | null>(null);

  const { bookings, loading, refetch, removeBooking } = useAllBookings();
  const { profiles } = useAllCustomerProfiles();
  const { tenant, plans } = useTenant();
  const { staff } = useTenantStaff();
  // スタッフのシフト。読めなければ空＝全員シフト未設定＝営業時間どおり（従来の挙動）。
  const { schedules: staffSchedules } = useStaffSchedules();
  // 予約時のカスタム質問。代理予約でも同じ内容を聞く（店が代わりに入力する）。
  const { questions: allQuestions } = useBookingQuestions();
  const proxyQuestions = useMemo(() => questionsForSurface(allQuestions, "member"), [allQuestions]);
  const [proxyAnswers, setProxyAnswers] = useState<Record<string, string>>({});
  const [missingProxyAnswerIds, setMissingProxyAnswerIds] = useState<string[]>([]);
  const staffSelectable = canSelectStaff(staff);
  const staffNames = staffNameMap(staff);
  const bookingBufferMinutes = tenant?.booking_buffer_minutes ?? 15;
  const sessionMinutes = tenant?.slot_duration_minutes ?? 60;
  // 代理予約する候補（proxyBookingType）の占有時間。プランごとの設定があればそちらを使う。
  // 「枠をブロックする」（時間帯を手動指定）はプランと無関係なので sessionMinutes のまま。
  const proxySlotMinutes = resolvePlanSlotMinutes(proxyBookingType, plans, sessionMinutes);
  // 代理予約でもオプションを付けられる（付けないと店側の予約だけ占有が短くなる）。選び直したら枠を外す。
  const proxyOpts = useBookingOptionSelection({ onChange: () => setProxyTime("") });
  const proxySessionMinutes = withOptions(proxySlotMinutes, proxyOpts.minutes);
  // 同時に受けられる予約数（ベッド数・施術者数）。未ロード時は安全側の1。
  // 予約を入れるときだけ使う。ブロック枠の作成は「1件でも予約があれば不可」のままにする
  // （ブロックは店全体を閉めるので、空きベッドがあっても既存予約を巻き込むため）。
  // 店の既定の同時受入数。時間帯の帯があればその枠だけ値が変わる（capacityAt）。
  const bookingCapacity = Math.max(tenant?.booking_capacity ?? 1, 1);
  const { windows: capacityWindows } = useBookingCapacityWindows();
  /** その日時で実際に使う同時受入数（帯が無ければ店の既定値） */
  const capacityAt = (dateKey: string, time: string) =>
    resolveSlotCapacity(capacityWindows, weekdayOfDateKey(dateKey), parseTimeToMinutes(time), bookingCapacity);
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
      resolveCycleUnit(profile.plan, plans),
      profile.cycle_start_pinned,
    );
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  // 週表示の行は営業時間そのもの（施術の長さは引かない）。
  // 以前は 600→1335（10:00-22:15）が直書きで、営業時間と無関係だった。
  const timeSlots = businessGridMinutes(tenant?.operating_hours).map(minutesToTime);

  const getSession = (day: Date, time: string) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return bookings.find(
      (b) => b.date === dateStr && b.startTime === time && b.status !== "キャンセル済み" && b.status !== SAME_DAY_FORFEIT_STATUS,
    );
  };

  const proxyDateKey = proxyDate ? format(proxyDate, "yyyy-MM-dd") : "";

  const handleProxyBook = async () => {
    if (!proxyDate || !proxyTime || !proxyClient || !proxyBookingType) {
      toast.error(t("schedule.errorSelectAll"));
      return;
    }
    // 指名した担当がその曜日に出勤していないなら、DB に届く前にここで止める
    // （届いても GB002 で落ちるが、理由が分かる文言で止めたほうが親切）。
    if (proxyStaffId && !staffWorksOnWeekday(tenant?.operating_hours, weekdayOfDateKey(proxyDateKey), staffSchedules, proxyStaffId)) {
      toast.error(t("staff.errorStaffOffShift"));
      return;
    }
    // 事前アンケートの必須項目。
    const missingProxy = missingRequiredQuestions(proxyQuestions, proxyAnswers);
    if (missingProxy.length > 0) {
      setMissingProxyAnswerIds(missingProxy.map((q) => q.id));
      toast.error(t("bookingQuestions.errorRequired", { label: missingProxy[0].label }));
      return;
    }
    setMissingProxyAnswerIds([]);
    const proxyAnswerSnapshot = buildAnswerSnapshot(proxyQuestions, proxyAnswers);
    if (checkSlotBlocked(bookings, proxyDateKey, proxyTime, undefined, bookingBufferMinutes, proxySessionMinutes, capacityAt(proxyDateKey, proxyTime), proxyStaffId || null)) {
      // 同時に受けられる予約数が既定の1のままだと、実際は2人同時に見られる店でも
      // ここで弾かれる。設定があること自体を知らないまま「アプリが対応していない」と
      // 諦められてしまうので、詰まったその場で設定の場所を案内する。
      // 🔴 この枠に時間帯別の帯が当たっているなら、直すべき場所は帯の設定
      // （既定値の案内を出すと、案内どおり既定値を上げても何も変わらない）。
      // 帯が無い枠は従来どおり: 既定1なら設定への案内、2以上なら本当に埋まっているだけ。
      const matchedWindow = matchedWindowCapacity(
        capacityWindows, weekdayOfDateKey(proxyDateKey), parseTimeToMinutes(proxyTime));
      toast.error(
        matchedWindow !== null ? t("schedule.errorSlotTakenWindowHint")
          : bookingCapacity <= 1 ? t("schedule.errorSlotTakenCapacityHint")
          : t("schedule.errorSlotTaken"),
      );
      return;
    }

    setSubmitting(true);

    // 定期予約: proxyRepeatWeeks > 1 なら毎週同じ曜日・時間でまとめて作成。
    // 満枠の週はスキップされる（結果はトーストで通知）。
    const client = profiles.find((p) => p.user_id === proxyClient);
    if (proxyRepeatWeeks > 1) {
      const { booked, skipped } = await createRecurringBookings(
        proxyClient, proxyDateKey, proxyTime, proxyBookingType, proxyRepeatWeeks, true,
        proxyStaffId || null, proxyAnswerSnapshot, proxyOpts.minutes, proxyOpts.snapshot);
      if (booked.length === 0) {
        toast.error(t("schedule.errorAddFailed"));
        setSubmitting(false);
        return;
      }
      toast.success(t("booking.repeatResult", { count: booked.length }));
      // 回数上限（GB003）でのスキップは満枠と案内を分ける（代理予約で出るのは
      // トレーナーが自分自身をお客様として選んだときだけ）。
      const fmtDates = (list: { date: string }[]) =>
        list.map((sk) => formatJST(`${sk.date}T00:00:00+09:00`, "M/d", { locale: ja })).join("、");
      const limitSkipped = skipped.filter((sk) => isBookingLimitError({ code: sk.code }));
      const otherSkipped = skipped.filter((sk) => !isBookingLimitError({ code: sk.code }));
      if (otherSkipped.length > 0) {
        toast.info(t("booking.repeatSkipped", { count: otherSkipped.length, dates: fmtDates(otherSkipped) }));
      }
      if (limitSkipped.length > 0) {
        toast.info(t("bookingLimits.repeatSkippedLimit", { count: limitSkipped.length, dates: fmtDates(limitSkipped) }));
      }
    } else {
      const { data: bookingData, error } = await createBooking(
        proxyClient, proxyDateKey, proxyTime, proxyBookingType, true,
        { staffUserId: proxyStaffId || null, customAnswers: proxyAnswerSnapshot,
          optionMinutes: proxyOpts.minutes, bookingOptions: proxyOpts.snapshot },
      );
      if (error) {
        // 店に空きがあるのに担当だけ埋まっている場合は、別の担当なら取れると案内する。
        // シフト外（GB002）は別の曜日か別の担当なら取れるので文言を分ける。
        // GB003（予約回数の制限）が代理予約で出るのは、トレーナーが**自分を**お客様として
        // 選んだときだけ（auth.uid() = user_id になり自己予約扱い）。設定で調整できると案内する。
        toast.error(t(proxyBookingErrorKey(error)));
        setSubmitting(false);
        return;
      }
      toast.success(t("schedule.addedToast", { name: client?.display_name || t("schedule.clientFallback"), date: format(proxyDate, "M/d"), time: proxyTime }));
    }

    setProxyDialogOpen(false);
    setProxyDate(undefined);
    setProxyAnswers({});
    proxyOpts.reset();
    setMissingProxyAnswerIds([]);
    setProxyTime("");
    setProxyClient("");
    setProxyBookingType("");
    setProxyStaffId("");
    setProxyRepeatWeeks(1);
    setSubmitting(false);
    void refetch();

    // 予約の通知（店宛メール・お客様の受付確認メール）はサーバー側が送る
    // （bookings の AFTER INSERT トリガー → notify-new-booking Edge Function）。
    // 端末発の送信は回線の瞬断で黙って消える沈黙故障を起こした（2026-08-21。
    // mem/features/booking-notify-server-side.md）。端末発に戻さないこと。
  };

  // 既存予約の担当を差し替える。空欄なら「指名なし」に戻す。
  // 差し替え先の担当がその時間帯に別の予約を持っていれば、DB のトリガー
  // guard_booking_staff_reassign が SQLSTATE 'GB001' で拒否する。
  const handleAssignStaff = async (nextStaffId: string) => {
    if (!assignTarget) return;
    setAssignSaving(true);
    const { error } = await supabase
      .from("bookings")
      .update({ staff_user_id: nextStaffId || null })
      .eq("id", assignTarget.id);
    setAssignSaving(false);
    if (error) {
      toast.error(isStaffConflictError(error) ? t("staff.errorStaffBusy") : t("staff.errorAssignFailed"));
      return;
    }
    toast.success(t("staff.assignedToast"));
    setAssignTarget(null);
    void refetch();
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
      // くり返しブロックで「この日以降まとめて解除」にチェックが入っていたら、
      // 同じグループの**この日以降**の行を全部消す。過去の行は残す（実績の記録なので）。
      // tenant_id の絞りは RLS（tenant_isolation）が最終防衛だが、明示もしておく。
      if (releaseSeriesChecked && target.recurrenceGroup) {
        const { data: released, error } = await supabase
          .from("blocked_slots")
          .delete()
          .eq("recurrence_group", target.recurrenceGroup)
          .gte("blocked_date", `${target.date}T00:00:00+09:00`)
          .select("id");
        if (error) {
          toast.error(t("schedule.releaseFailed"));
          setDeleting(false);
          return;
        }
        toast.success(t("schedule.releasedSeriesToast", { count: (released ?? []).length }));
        void refetch();
        setDeleting(false);
        setDeleteTarget(null);
        return;
      }
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
    const forfeit = deleteTargetForfeitable && forfeitChecked;
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
      const res = await cancelBooking(target.id, true, { forfeit });
      error = res.error;
    }

    if (error) {
      console.error("Failed to delete booking:", error);
      const isPermissionError = error.code === "42501" || error.message?.includes("row-level security");
      toast.error(isPermissionError ? t("schedule.permissionDenied") : t("common.errorGeneric"));
      setDeleting(false);
      return;
    }

    // 消化扱い（forfeit）の場合は物理削除ではなくstatus更新のため、行自体は
    // （予定表には表示されなくなるが）他の予約の消化数カウント（進捗バッジ）の
    // 計算対象としてローカル状態に残す必要がある。removeBookingで完全に消して
    // しまうとカウントが一時的にずれるため、代わりに再取得する。
    if (booking?.user_id !== "trial-guest" && forfeit) {
      void refetch();
    } else {
      removeBooking(target.id);
    }
    toast.success(t("schedule.deletedToast"));
    setDeleting(false);
    setDeleteTarget(null);
  };

  const handleBlockSlot = async () => {
    if (!blockDate || !blockStartTime || !blockEndTime || !user) return;

    if (blockEndTime <= blockStartTime) {
      toast.error(t("schedule.blockEndAfterStart"));
      return;
    }

    setSubmitting(true);
    const { fetchMyTenantId, withTenant } = await import("@/lib/tenantHelper");
    const tenantId = await fetchMyTenantId();

    // くり返し: 毎週同じ曜日・時間で blockRepeatWeeks 週ぶんの実体行を作る
    // （定期予約 createRecurringBookings と同じ方式。恒久ルールの表にしないのは、
    //  公開済みの旧クライアントが実体行しか読まないため）。
    // 予約やブロックと重なる週はスキップして結果をトーストで知らせる。
    // グループIDは繰り返しのときだけ積む（未適用のDBに常に積むと PGRST204 で
    // 単発ブロックまで作れなくなる。staff_user_id と同じ作法）。
    const recurrenceGroup = blockRepeatWeeks > 1 ? crypto.randomUUID() : null;
    const [by, bm, bd] = format(blockDate, "yyyy-MM-dd").split("-").map(Number);
    const rows: Record<string, unknown>[] = [];
    const skippedDates: string[] = [];
    for (let i = 0; i < blockRepeatWeeks; i++) {
      // ローカル日付で +7日ずつ（時刻を持たない日付演算のためTZずれ無し）
      const d = new Date(by, bm - 1, bd + i * 7);
      const dateStr = format(d, "yyyy-MM-dd");
      if (checkSlotBlocked(bookings, dateStr, blockStartTime, blockEndTime, bookingBufferMinutes, sessionMinutes)) {
        skippedDates.push(format(d, "M/d"));
        continue;
      }
      rows.push(withTenant({
        blocked_date: `${dateStr}T${blockStartTime}:00+09:00`,
        end_blocked_date: `${dateStr}T${blockEndTime}:00+09:00`,
        created_by: user.id,
        reason: t("schedule.blockReason", { start: blockStartTime, end: blockEndTime }),
        ...(recurrenceGroup ? { recurrence_group: recurrenceGroup } : {}),
      }, tenantId));
    }

    if (rows.length === 0) {
      toast.error(t("schedule.blockOverlap"));
      setSubmitting(false);
      return;
    }

    const { error } = await supabase.from("blocked_slots").insert(rows as any);

    if (error) {
      toast.error(t("schedule.blockFailed"));
      setSubmitting(false);
      return;
    }

    if (blockRepeatWeeks > 1) {
      toast.success(t("schedule.blockRepeatResult", { count: rows.length, start: blockStartTime, end: blockEndTime }));
      if (skippedDates.length > 0) {
        toast.info(t("schedule.blockRepeatSkipped", { count: skippedDates.length, dates: skippedDates.join("、") }));
      }
    } else {
      toast.success(t("schedule.blockedToast", { date: format(blockDate, "M/d"), start: blockStartTime, end: blockEndTime }));
    }
    setBlockDialogOpen(false);
    setBlockDate(undefined);
    setBlockStartTime("");
    setBlockEndTime("");
    setBlockRepeatWeeks(1);
    setSubmitting(false);
    void refetch();
  };

  const getDayBookings = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    return bookings.filter((b) => b.date === dateStr && b.status !== "キャンセル済み" && b.status !== SAME_DAY_FORFEIT_STATUS);
  };

  // ── その日の受付を止める（GB007）。読み込み・保存・人数の数え方は useDayReception に置いた
  const dayReception = useDayReception(
    format(weekStart, "yyyy-MM-dd"),
    format(addDays(weekStart, 6), "yyyy-MM-dd"),
    bookings,
    tenant?.daily_booking_limit ?? null,
  );

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
          operatingHours={tenant?.operating_hours}
          renderDayReception={(dateKey) => (
            <DayReceptionToggle
              compact
              dateKey={dateKey}
              closed={dayReception.closedOn(dateKey)}
              bookedCount={dayReception.bookedCountOn(dateKey)}
              dailyLimit={dayReception.dailyLimit}
              saving={dayReception.saving}
              onClose={dayReception.closeDay}
              onReopen={dayReception.reopenDay}
            />
          )}
          profiles={profiles.map((p) => ({
            user_id: p.user_id,
            plan: p.plan ?? null,
            cycle_start_date: p.cycle_start_date ?? null,
            cycle_start_pinned: p.cycle_start_pinned ?? false,
            // 渡し忘れると猶予OFFのお客様にも猶予が適用された進捗バッジが出る
            // （ProfileLite.grace_enabled はオプショナルのため型エラーにならない）
            grace_enabled: p.grace_enabled ?? null,
          }))}
          onSelectBooking={(b) => {
            setDeleteTarget({
              id: b.id,
              clientName: b.clientName,
              date: b.date,
              startTime: b.startTime,
              isBlocked: b.isBlocked,
              recurrenceGroup: b.recurrenceGroup ?? null,
            });
            setReleaseSeriesChecked(false);
          }}
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
                          {/* その日の受付を止める／解除する1タップ（GB007） */}
                          <div className="mt-1">
                            <DayReceptionToggle
                              compact
                              dateKey={format(day, "yyyy-MM-dd")}
                              closed={dayReception.closedOn(format(day, "yyyy-MM-dd"))}
                              bookedCount={dayReception.bookedCountOn(format(day, "yyyy-MM-dd"))}
                              dailyLimit={dayReception.dailyLimit}
                              saving={dayReception.saving}
                              onClose={dayReception.closeDay}
                              onReopen={dayReception.reopenDay}
                            />
                          </div>
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
                                    aria-label={session.isBlocked ? t("schedule.blockedRelease") : t("schedule.deleteBookingAria", { name: session.clientName })}
                                    onClick={() => { setDeleteTarget({ id: session.id, clientName: session.clientName, date: session.date, startTime: session.startTime, isBlocked: session.isBlocked, recurrenceGroup: session.recurrenceGroup ?? null }); setForfeitChecked(true); setReleaseSeriesChecked(false); }}
                                    className="absolute top-1 right-1 h-7 w-7 rounded-md"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                  <p className="font-bold truncate">{session.isBlocked ? t("schedule.blockedLabel") : session.clientName}</p>
                                  <p className="opacity-75 truncate">{session.startTime}〜{session.endTime}</p>
                                  {!session.isBlocked && <p className="opacity-60 truncate text-[9px] mt-0.5">{session.booking_type}</p>}
                                  {!session.isBlocked && staffSelectable && session.staff_user_id && (
                                    <p className="opacity-60 truncate text-[9px]">{staffNames[session.staff_user_id] ?? ""}</p>
                                  )}
                                  {!session.isBlocked && <BookingOptionLine options={session.bookingOptions} variant="grid" />}
                                  <BookingProgressBadge progress={getProgress(session)} className="mt-1" />
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
                {/* その日の受付を止める／解除する1タップ（GB007） */}
                <DayReceptionToggle
                  dateKey={format(day, "yyyy-MM-dd")}
                  closed={dayReception.closedOn(format(day, "yyyy-MM-dd"))}
                  bookedCount={dayReception.bookedCountOn(format(day, "yyyy-MM-dd"))}
                  dailyLimit={dayReception.dailyLimit}
                  saving={dayReception.saving}
                  onClose={dayReception.closeDay}
                  onReopen={dayReception.reopenDay}
                />
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
                              booking.isBlocked
                                ? "bg-muted text-muted-foreground"
                                : "accent-gradient text-accent-foreground"
                            }`}>
                              {booking.isBlocked ? "—" : booking.clientName[0]}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold truncate">{booking.isBlocked ? t("schedule.blockedLabel") : booking.clientName}</p>
                              <p className="text-xs text-muted-foreground">{booking.startTime}〜{booking.endTime}</p>
                              {!booking.isBlocked && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{booking.booking_type}</p>}
                              {!booking.isBlocked && staffSelectable && (
                                <p className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
                                  <UserRound className="w-3 h-3 shrink-0" />
                                  {booking.staff_user_id ? (staffNames[booking.staff_user_id] ?? t("common.unknown")) : t("staff.unassigned")}
                                </p>
                              )}
                              <BookingProgressBadge progress={getProgress(booking)} className="mt-1" />
                              {!booking.isBlocked && <BookingOptionLine options={booking.bookingOptions} variant="card" />}
                            </div>
                          </div>
                          {/* 事前アンケートの回答。無い予約には何も出さない（既存の見た目は変わらない）。
                              質問を後から直しても、ここには「聞いたときの文言」が出る。 */}
                          {!booking.isBlocked && (booking.customAnswers?.length ?? 0) > 0 && (
                            <div className="mt-2 rounded-lg bg-muted/40 p-2 space-y-1">
                              <p className="text-[10px] font-bold text-muted-foreground flex items-center gap-1">
                                <ClipboardList className="w-3 h-3" />
                                {t("bookingQuestions.answersTitle")}
                              </p>
                              {booking.customAnswers!.map((a, i) => (
                                <p key={`${a.question_id}-${i}`} className="text-[11px] leading-snug">
                                  <span className="text-muted-foreground">{a.label}：</span>
                                  <span className="font-medium">{a.value}</span>
                                </p>
                              ))}
                            </div>
                          )}
                          <div className="mt-3 flex justify-end gap-2">
                            {/* 体験予約（user_id が trial-guest）は担当を持たないので変更ボタンを出さない */}
                            {!booking.isBlocked && staffSelectable && booking.user_id !== "trial-guest" && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setAssignTarget({
                                  id: booking.id,
                                  clientName: booking.clientName,
                                  date: booking.date,
                                  startTime: booking.startTime,
                                  staffUserId: booking.staff_user_id ?? null,
                                })}
                                className="min-w-[112px]"
                              >
                                <UserRound className="w-4 h-4" />
                                {t("staff.changeAssignee")}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => { setDeleteTarget({ id: booking.id, clientName: booking.clientName, date: booking.date, startTime: booking.startTime, isBlocked: booking.isBlocked, recurrenceGroup: booking.recurrenceGroup ?? null }); setForfeitChecked(true); setReleaseSeriesChecked(false); }}
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
            {/* 担当スタッフ。1人しか居ないジムには出さない（選ぶ意味が無い）。
                選び直すと空き枠の見え方が変わるので、選択中の時刻は解除する。 */}
            {staffSelectable && (
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("staff.selectLabel")}</label>
                <select
                  value={proxyStaffId}
                  onChange={(e) => { setProxyStaffId(e.target.value); setProxyTime(""); }}
                  className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">{t("staff.anyone")}</option>
                  {staff.map((sm) => (
                    <option key={sm.user_id} value={sm.user_id}>{sm.display_name}</option>
                  ))}
                </select>
              </div>
            )}
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
                disabled={(date) => {
                  const key = format(date, "yyyy-MM-dd");
                  // ⚠️ 受付期間（tenants.booking_window_days）は**わざと見ていない**。
                  //    あれは「お客様に向けた受付の制限」であって、店が自分で入れる
                  //    予約の制限ではない（電話で3ヶ月先を押さえたい、はあり得る）。
                  //    見落としではないので、後から足さないこと。
                  // 定休日。店側の代理予約でも、閉めている日に枠は出せない
                  // （どうしても入れたいなら営業時間の設定を直すのが筋）。
                  if (isClosedDate(tenant?.operating_hours, key)) return true;
                  // 指名した担当が出勤していない曜日。指名なしなら常に false。
                  return !staffWorksOnWeekday(
                    tenant?.operating_hours, weekdayOfDateKey(key), staffSchedules, proxyStaffId || null,
                  );
                }}
                className="pointer-events-auto border rounded-lg mx-auto"
              />
            </div>
            {proxyDate && (
              <div id="proxy-time-slots-section" className="scroll-mt-4">
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("schedule.labelStartTime")}</label>
                <BookingOptionPicker options={proxyOpts.options} selectedIds={proxyOpts.selectedIds} onToggle={proxyOpts.toggle} disabled={submitting} className="mb-3" />
                <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                  {(() => {
                    const slots: { time: string; blocked: boolean }[] = [];
                    // 予約枠なので終業から枠の長さを引く。以前は 600→1260（10:00-21:00）が
                    // 直書きで、営業時間を延ばしても 21:00 で止まっていた。
                    // 曜日別の営業時間と、指名した担当のシフトまで反映する。
                    for (const totalMin of staffBookingSlotMinutes(
                      tenant?.operating_hours, proxySessionMinutes, weekdayOfDateKey(proxyDateKey),
                      staffSchedules, proxyStaffId || null,
                    )) {
                      const time = minutesToTime(totalMin);
                      const blocked = checkSlotBlocked(bookings, proxyDateKey, time, undefined, bookingBufferMinutes, proxySessionMinutes, capacityAt(proxyDateKey, time), proxyStaffId || null);
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
            {/* 事前アンケート（店が設定した質問）。店が代わりに入力する。 */}
            {proxyDate && proxyTime && proxyQuestions.length > 0 && (
              <div className="rounded-xl bg-muted/30 p-3">
                <p className="text-[11px] font-bold text-muted-foreground mb-2 flex items-center gap-1">
                  <ClipboardList className="w-3 h-3" />
                  {t("bookingQuestions.sectionTitle")}
                </p>
                <BookingQuestionFields
                  questions={proxyQuestions}
                  values={proxyAnswers}
                  onChange={(id, value) => setProxyAnswers((prev) => ({ ...prev, [id]: value }))}
                  missingIds={missingProxyAnswerIds}
                  requiredLabel={t("bookingQuestions.required")}
                  checkedValue={t("bookingQuestions.checked")}
                  disabled={submitting}
                />
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

      <Dialog open={!!assignTarget} onOpenChange={(open) => { if (!open && !assignSaving) setAssignTarget(null); }}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("staff.changeAssignee")}</DialogTitle>
          </DialogHeader>
          {assignTarget && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("staff.changeAssigneeDesc", {
                  name: assignTarget.clientName,
                  date: formatJST(`${assignTarget.date}T00:00:00+09:00`, "M/d"),
                  time: assignTarget.startTime,
                })}
              </p>
              <div className="space-y-1.5">
                <button
                  type="button"
                  disabled={assignSaving}
                  onClick={() => handleAssignStaff("")}
                  className={`w-full text-left px-3 py-3 rounded-lg text-sm font-semibold transition-all min-h-[44px] ${
                    assignTarget.staffUserId === null
                      ? "bg-accent text-accent-foreground"
                      : "bg-secondary text-foreground hover:bg-secondary/70"
                  }`}
                >
                  {t("staff.unassigned")}
                </button>
                {staff.map((sm) => (
                  <button
                    key={sm.user_id}
                    type="button"
                    disabled={assignSaving}
                    onClick={() => handleAssignStaff(sm.user_id)}
                    className={`w-full text-left px-3 py-3 rounded-lg text-sm font-semibold transition-all min-h-[44px] ${
                      assignTarget.staffUserId === sm.user_id
                        ? "bg-accent text-accent-foreground"
                        : "bg-secondary text-foreground hover:bg-secondary/70"
                    }`}
                  >
                    {sm.display_name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignTarget(null)} disabled={assignSaving} className="w-full sm:w-auto">
              {t("common.cancel")}
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
          {deleteTarget?.isBlocked && deleteTarget.recurrenceGroup && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <Checkbox
                id="release-series-checkbox"
                checked={releaseSeriesChecked}
                onCheckedChange={(v) => setReleaseSeriesChecked(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="release-series-checkbox" className="text-sm font-normal leading-snug cursor-pointer">
                {t("schedule.blockSeriesRelease")}
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {t("schedule.blockSeriesReleaseDesc", { date: deleteTarget.date })}
                </span>
              </Label>
            </div>
          )}
          {/* 予約をタップした先の導線。消す以外にできることがここしか無いので、
              「オプションを変更」もここから開く（ブロック枠には出さない） */}
          {deleteTarget && !deleteTarget.isBlocked && (
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                const b = bookings.find((x) => x.id === deleteTarget.id) ?? null;
                setDeleteTarget(null);
                setOptionTarget(b);
              }}
            >
              <Sparkles className="w-4 h-4 mr-1" />
              {t("bookingOptions.editOpen")}
            </Button>
          )}
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
      <Dialog open={blockDialogOpen} onOpenChange={(o) => { setBlockDialogOpen(o); if (!o) setBlockRepeatWeeks(1); }}>
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
                      // ブロック枠（休憩・設営）は施術ではないので、終業まで置ける。
                      // 曜日を渡さないのは意図的。**定休日にもブロック枠を置けるようにする**
                      // （棚卸し・研修など、閉めている日に予定を書きたい要望がある）。
                      for (const totalMin of businessGridMinutes(tenant?.operating_hours)) {
                        const time = minutesToTime(totalMin);
                      const blocked = checkSlotBlocked(bookings, blockDateKey, time, undefined, bookingBufferMinutes, sessionMinutes);
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
                        // 終業ちょうどで終われる。以前は 1290（22:30）が直書きだった。
                        for (const totalMin of blockEndMinutes(tenant?.operating_hours, startMin)) {
                          const time = minutesToTime(totalMin);
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
                {/* くり返しブロック: 毎週同じ曜日・時間でまとめてブロック（定期予約と同じ選択UI）。
                    ブロックは休憩・貸し出しなど長めの固定予定が多いので、定期予約より長い
                    12週（約3ヶ月）まで選べる。それ以上は「消化されたらまた入れる」運用。 */}
                {blockStartTime && blockEndTime && (
                  <div>
                    <p className="text-[11px] font-bold text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Repeat className="w-3 h-3" />
                      {t("schedule.blockRepeatTitle")}
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[1, 2, 3, 4, 6, 8, 10, 12].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setBlockRepeatWeeks(n)}
                          aria-pressed={blockRepeatWeeks === n}
                          className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                            blockRepeatWeeks === n
                              ? "bg-destructive text-destructive-foreground shadow-sm"
                              : "bg-secondary text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {n === 1 ? t("booking.repeatOnce") : t("schedule.blockRepeatWeeks", { count: n })}
                        </button>
                      ))}
                    </div>
                    {blockRepeatWeeks > 1 && (
                      <p className="text-[11px] text-muted-foreground mt-1.5">
                        {t("schedule.blockRepeatWeeklyDesc", { count: blockRepeatWeeks })}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setBlockDialogOpen(false)} className="w-full sm:w-auto">{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={handleBlockSlot} disabled={!blockDate || !blockStartTime || !blockEndTime || submitting} className="w-full sm:w-auto">
              {submitting && <DumbbellLoader className="w-4 h-4 mr-1" />}
              {blockRepeatWeeks > 1 ? t("schedule.blockRepeatBtn", { count: blockRepeatWeeks }) : t("schedule.blockBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BookingOptionEditDialog
        booking={optionTarget}
        onClose={() => setOptionTarget(null)}
        onSaved={() => refetch()}
      />
    </div>
  );
};

export default TrainerSchedule;
