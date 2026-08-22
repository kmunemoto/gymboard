import { Users, CalendarDays, TrendingUp, Clock, BarChart3, ClipboardList, UserRoundX, ChevronRight, MessageCircle, UserCheck, Banknote } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { useAllCustomerProfiles, useProfile } from "@/hooks/useProfile";
import { useAllBookings, SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";
import { formatJST, getJSTNow } from "@/lib/timezone";
import { addDays, startOfDay } from "date-fns";
import CounselingResponseList from "./CounselingResponseList";
import TrainerUtilizationHeatmap from "./TrainerUtilizationHeatmap";
import { useCounselingResponses } from "@/hooks/useCounselingResponses";
import CourseProgressBadge from "./CourseProgressBadge";
import { getBookingProgressIndex, resolveCycleMonths, resolveCycleUnit, resolveGraceDays, type BookingForProgress } from "@/lib/courseProgress";
import { computePlanUsage, resolvePlanUsageInput } from "@/lib/planUsage";
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TRIAL_BOOKING_ENABLED, WAITLIST_ENABLED } from "@/lib/featureFlags";
import { useTenantPayments } from "@/hooks/useMemberPayments";
import { formatYen, outstandingMembers, revenueByMonth as revenueByMonthOf } from "@/lib/memberPayments";
import { isActiveMember } from "@/lib/memberLifecycle";

// 同時受入数の選択肢。設定画面（BUSINESS_CAPACITY_OPTIONS）・
// オンボーディング（CAPACITY_OPTIONS）と必ず同じ並びにする。
const CONFIRM_CAPACITY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];


interface TrainerDashboardProps {
  onSelectClient: (clientId: string) => void;
  /** 離脱アラートの「声かけ」: 指定顧客との会話を開いた状態でメッセージ画面へ */
  onMessageClient?: (clientId: string) => void;
  /** 体験フォロー待ちバナー: 体験フォロー管理タブへ */
  onNavigateFollowUps?: () => void;
}

const addMonthsToDateKey = (dateKey: string, months: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const getRecentMonths = (todayKey: string, count = 4) => {
  const currentMonthStart = `${todayKey.slice(0, 7)}-01`;
  return Array.from({ length: count }, (_, index) => addMonthsToDateKey(currentMonthStart, index - count + 1));
};

const TrainerDashboard = ({ onSelectClient, onMessageClient, onNavigateFollowUps }: TrainerDashboardProps) => {
  const { t } = useTranslation();
  const { profiles, loading } = useAllCustomerProfiles();
  const { bookings, loading: bookingsLoading } = useAllBookings();
  const { unreadCount: counselingUnread, responses: counselingResponses, isLoading: counselingLoading } = useCounselingResponses();
  const { profile: trainerProfile } = useProfile();
  const { plans: tenantPlans, tenant, refetch: refetchTenant } = useTenant();
  const trainerName = trainerProfile?.display_name || t("dashboard.trainerFallback");
  // ジム設定で「フォローが必要な顧客」の表示をオフにできる（既定は表示）。
  const showRetentionAlerts = tenant?.show_retention_alerts !== false;
  // ダッシュボード上部の統計カード。ジムごとに個別に表示/非表示できる（既定は全て表示）。
  const showStatTodaySessions = tenant?.show_stat_today_sessions !== false;
  const showStatActiveClients = tenant?.show_stat_active_clients !== false;
  const showStatMonthSessions = tenant?.show_stat_month_sessions !== false;
  const showStatMonthRevenue = tenant?.show_stat_month_revenue !== false;
  // ホーム画面の各セクション。同じくジムごとにON/OFF（既定は全て表示）。
  const showTodaySchedule = tenant?.show_today_schedule !== false;
  const showTrialFollowUpAlert = TRIAL_BOOKING_ENABLED && tenant?.show_trial_followup_alert !== false;
  const showRenewalAlerts = tenant?.show_renewal_alerts !== false;
  const showCounselingResponses = tenant?.show_counseling_responses !== false;
  const showRevenueChart = tenant?.show_revenue_chart !== false;
  const showUtilizationHeatmap = tenant?.show_utilization_heatmap !== false;

  // 体験フォロー待ち件数（体験CRM）。follow_up_status 列がマイグレーション未適用の環境では
  // 取得エラーになるため、その場合は静かに0件扱いにする（バナー非表示）。
  const [pendingFollowUps, setPendingFollowUps] = useState(0);
  useEffect(() => {
    if (!TRIAL_BOOKING_ENABLED || !tenant?.id) return;
    let cancelled = false;
    (async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await (supabase
        .from("trial_bookings") as any)
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("follow_up_status", "未対応")
        .lt("booking_date", nowIso);
      if (cancelled) return;
      if (error) {
        setPendingFollowUps(0);
        return;
      }
      setPendingFollowUps((data || []).length);
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  // これから先のキャンセル待ち＝「予約したかったのに満枠で入れなかった」需要。
  //
  // これまでこのテーブルはお客様が登録するだけで、**店側から見る画面がどこにも無かった**。
  // 取りこぼしが起きても店は永久に気づけない。特に booking_capacity が既定の1のまま
  // 複数人で回している店では、実際には空いているのに満枠と表示されているため、
  // ここが唯一の手がかりになる（mem/features/booking-capacity.md）。
  const [waitingSlots, setWaitingSlots] = useState<{ date: string; time: string; count: number }[]>([]);
  useEffect(() => {
    if (!WAITLIST_ENABLED || !tenant?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await (supabase
        .from("booking_waitlist") as any)
        .select("booking_date, start_time")
        .eq("tenant_id", tenant.id)
        .gte("booking_date", formatJST(new Date(), "yyyy-MM-dd"));
      if (cancelled) return;
      if (error) {
        // テーブル未適用の環境では静かに0件扱い（バナー非表示）。
        setWaitingSlots([]);
        return;
      }
      // 同じ枠に複数人が待っていることがあるので、枠ごとにまとめる
      const bySlot = new Map<string, { date: string; time: string; count: number }>();
      for (const row of (data || []) as { booking_date: string; start_time: string }[]) {
        const key = `${row.booking_date} ${row.start_time}`;
        const hit = bySlot.get(key);
        if (hit) hit.count += 1;
        else bySlot.set(key, { date: row.booking_date, time: row.start_time, count: 1 });
      }
      setWaitingSlots(
        [...bySlot.values()].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
      );
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

  const waitingTotal = waitingSlots.reduce((sum, s) => sum + s.count, 0);
  // 同時1件までの設定のまま待ちが出ている＝「本当に満席」か「設定が実態と違う」かの
  // どちらか。店にしか判断できないので、決めつけず設定の場所だけ添える。
  const showCapacityHint = (tenant?.booking_capacity ?? 1) <= 1;

  // 「同時に受けられる予約数」を店に一度だけ確認する導線（未確認のときだけ表示）。
  const [capacityAnswer, setCapacityAnswer] = useState(1);
  const [capacitySaving, setCapacitySaving] = useState(false);
  useEffect(() => {
    // 現在値を初期選択にする（既定1のままなら1が選ばれる）
    setCapacityAnswer(Math.max(tenant?.booking_capacity ?? 1, 1));
  }, [tenant?.booking_capacity]);

  const saveCapacityAnswer = async () => {
    if (!tenant?.id || capacitySaving) return;
    setCapacitySaving(true);
    // 値と「確認した」を同時に書く。1のままでも確認済みとして記録し、二度は聞かない。
    const { error } = await supabase
      .from("tenants")
      .update({
        booking_capacity: capacityAnswer,
        booking_capacity_confirmed_at: new Date().toISOString(),
      } as never)
      .eq("id", tenant.id);
    setCapacitySaving(false);
    if (error) { toast.error(t("common.errorGeneric")); return; }
    toast.success(t("capacityConfirm.saved"));
    refetchTenant();
  };

  const today = formatJST(new Date(), "yyyy-MM-dd");

  // 入金の記録。グラフに出す4ヶ月分だけ取る（全期間を引くと行数が年々増える）。
  const paymentsFromMonth = getRecentMonths(today)[0].slice(0, 7);
  const { payments: tenantPayments } = useTenantPayments(paymentsFromMonth);
  // 本日のスケジュールには体験予約（user_id === "trial-guest"）も含める。
  // トレーナーが当日その枠に対応するため予定として表示する必要がある。
  // （月間セッション数・売上の集計では体験は無料/非会員のため引き続き除外する）
  // 同日キャンセル消化(SAME_DAY_FORFEIT_STATUS)は「来店しない」予約のため、
  // 本日のスケジュール・件数からは除外する（消化数カウント自体は courseProgress 側で継続）。
  const todayBookings = bookings.filter(
    (b) => b.date === today && b.status !== "キャンセル済み" && b.status !== SAME_DAY_FORFEIT_STATUS && b.user_id !== "blocked",
  );

  const bookingsByUser = useMemo(() => {
    const map = new Map<string, BookingForProgress[]>();
    bookings
      .filter((b) => b.user_id !== "trial-guest" && b.user_id !== "blocked")
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
  }, [bookings]);

  // Count this month's sessions (exclude blocked/trial guest, exclude cancellations)
  const currentMonth = formatJST(new Date(), "yyyy-MM");
  const monthBookings = bookings.filter(
    (b) =>
      b.date.startsWith(currentMonth) &&
      b.status !== "キャンセル済み" &&
      b.user_id !== "blocked" &&
      b.user_id !== "trial-guest",
  );

  // 売上:
  //  **実際に受け取った入金（member_payments）だけを数える。**
  //
  //  🔴 2026-08-08 に方式を変えた。それまでは「定価 × サイクル開始日」の推計で、
  //     受け取ったかどうかは一切見ていなかった。滞納していても満額が計上されるため、
  //     「今月いくら入ったか」を経営判断に使える数字ではなかった。
  //     推計していた getRevenueCycleStartDates は同時に削除した（残すと
  //     「どっちが本物か」が分からなくなる）。経緯は mem/features/member-lifecycle.md。
  const revenueByMonth = useMemo(() => revenueByMonthOf(tenantPayments), [tenantPayments]);

  const currentMonthRevenue = revenueByMonth.get(currentMonth) || 0;

  const revenueMonths = getRecentMonths(today);
  const revenueData = revenueMonths.map((monthStart) => {
    const monthKey = monthStart.slice(0, 7);
    const monthNumber = Number(monthStart.slice(5, 7));
    return { month: t("dashboard.monthLabel", { month: monthNumber }), revenue: revenueByMonth.get(monthKey) || 0 };
  });

  // 表示期間に入金の記録が1件も無いジム＝まだ記録を始めていない。
  // グラフが全部ゼロなだけだと「壊れた」と読まれるので、案内を出す。
  const hasAnyPaymentRecord = tenantPayments.length > 0;

  const activeClientCount = profiles.filter((p) => isActiveMember(p.status)).length;

  // 今月の入金が未記録の在籍会員。
  // ⚠️ **「未収」ではない。** 記録し忘れているだけかもしれないので、督促も予約ブロックもしない。
  //    休会・退会とプラン未設定の人は最初から出さない（払わなくて当然なので）。
  const unrecordedThisMonth = useMemo(
    () =>
      outstandingMembers({
        members: profiles.map((p) => ({
          user_id: p.user_id,
          name: p.display_name || t("common.nameUnset"),
          status: p.status,
          planName: p.plan,
        })),
        payments: tenantPayments,
        monthKey: currentMonth,
        priceOf: (planName) => tenantPlans.find((tp) => tp.plan_name === planName)?.price ?? null,
        isActive: isActiveMember,
      }),
    [profiles, tenantPayments, currentMonth, tenantPlans, t],
  );

  // フォローが必要な顧客（離脱検知）:
  //  最終来店から INACTIVE_DAYS 日以上経過し、今後の予約が無い顧客を抽出。
  //  既存テーブル（bookings / profiles）の派生計算のみ。スキーマ変更なし。
  const INACTIVE_DAYS = 14;
  const atRiskCustomers = useMemo(() => {
    const now = new Date();
    // ユーザーごとの最終来店日（過去の非キャンセル予約の最大日）と、今後予約の有無
    // 同日キャンセル消化(SAME_DAY_FORFEIT_STATUS)は「来店していない」ため除外する
    // （含めると消化した顧客の最終来店日が更新され、離脱リストから漏れてしまう）
    const visit = new Map<string, { last: string | null; upcoming: boolean }>();
    bookings.forEach((b) => {
      if (b.status === "キャンセル済み" || b.status === SAME_DAY_FORFEIT_STATUS || b.user_id === "blocked" || b.user_id === "trial-guest") return;
      const dt = new Date(`${b.date}T${b.startTime || "00:00"}:00+09:00`);
      const info = visit.get(b.user_id) || { last: null, upcoming: false };
      if (dt <= now) {
        if (!info.last || b.date > info.last) info.last = b.date;
      } else {
        info.upcoming = true;
      }
      visit.set(b.user_id, info);
    });

    const daysBetween = (fromIso: string) =>
      Math.floor((now.getTime() - new Date(fromIso).getTime()) / 86400000);

    type Risk = { user_id: string; name: string; reason: "lapsed" | "neverBooked"; days: number };
    const list: Risk[] = [];
    profiles.forEach((p) => {
      // 休会中の人は来なくて当然。離脱リスクとして毎日出すと本当の離脱が埋もれる。
      if (!isActiveMember(p.status)) return;
      const info = visit.get(p.user_id);
      const hasUpcoming = (info?.upcoming ?? false) || !!p.next_booking_date;
      if (hasUpcoming) return;
      const name = p.display_name || t("common.nameUnset");
      if (info?.last) {
        const days = daysBetween(`${info.last}T23:59:59+09:00`);
        if (days >= INACTIVE_DAYS) list.push({ user_id: p.user_id, name, reason: "lapsed", days });
      } else {
        // 一度も予約がない顧客（登録から日が経っているもののみ）
        const joined = p.created_at ? daysBetween(p.created_at) : 0;
        if (joined >= INACTIVE_DAYS) list.push({ user_id: p.user_id, name, reason: "neverBooked", days: joined });
      }
    });
    return list.sort((a, b) => b.days - a.days);
  }, [bookings, profiles, t]);

  // 更新が近い顧客（プラン更新リマインド）:
  //  現在のサイクル満了（=月次更新/支払いの起点）まで RENEWAL_SOON_DAYS 日以内の顧客。
  //  消化状況カードと同じ computePlanUsage（実効サイクル）で判定し、
  //  回数使い切り後の自動ロール・猶予・期限未確定と表示が食い違わないようにする。
  const RENEWAL_SOON_DAYS = 7;
  const renewalSoon = useMemo(() => {
    const now = getJSTNow();
    const todayStart = startOfDay(now);
    type Renewal = { user_id: string; name: string; days: number; remaining: number | null; isUnlimited: boolean };
    const list: Renewal[] = [];
    profiles.forEach((p) => {
      // 休会中はサイクルが進まない。更新の催促を出すのは在籍に戻してから。
      if (!isActiveMember(p.status)) return;
      if (!p.cycle_start_date || !p.plan) return;
      const tenantPlan = tenantPlans.find((tp) => tp.plan_name === p.plan) ?? null;
      const input = resolvePlanUsageInput(p.plan, tenantPlan, p.cycle_start_date, p.cycle_start_pinned);
      if (!input) return;
      if (p.grace_enabled === false) input.graceDays = 0; // 猶予OFFのお客様は期限どおり
      const usage = computePlanUsage(input, bookingsByUser.get(p.user_id) || [], now);
      if (usage.kind !== "subscription" || usage.isUnconfigured || !usage.windowEnd) return;
      // 期限未確定（今サイクルに予約0件＝1回目の予約待ち）は更新リマインド対象外
      if (usage.periodPending) return;
      const anniversary = addDays(usage.windowEnd, -1); // サイクル最終日（満了日）
      const days = Math.round((startOfDay(anniversary).getTime() - todayStart.getTime()) / 86400000);
      if (days < 0 || days > RENEWAL_SOON_DAYS) return;
      list.push({ user_id: p.user_id, name: p.display_name || t("common.nameUnset"), days, remaining: usage.remaining, isUnlimited: usage.isUnlimited });
    });
    return list.sort((a, b) => a.days - b.days);
  }, [profiles, bookingsByUser, tenantPlans, t]);

  if (loading || bookingsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  return (
    <div className="pb-24 md:pb-0">
      {/* Header */}
      <div className="gym-gradient rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6 text-primary-foreground relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-accent/10 -translate-y-12 translate-x-12" />
        <div className="relative">
          <p className="text-xs sm:text-sm opacity-75">{t("dashboard.title")}</p>
          <h1 className="text-lg sm:text-2xl font-bold mt-1">{trainerName}</h1>
          <p className="text-xs sm:text-sm opacity-75 mt-1">{formatJST(new Date(), t("dashboard.dateFormat"))}</p>
        </div>
      </div>

      {/* Stats Grid（各カードはジム設定でON/OFF可能。全てOFFならセクションごと非表示） */}
      {(() => {
        const statCards = [
          showStatTodaySessions && { label: t("dashboard.statTodaySessions"), value: t("dashboard.countUnit", { count: todayBookings.length }), icon: CalendarDays, color: 'text-accent' },
          // 「アクティブ顧客」なので休会中は数えない。顧客一覧の総数（休会も含む）とは
          // 意図的に食い違う。合わせたくなったら、まずラベルの意味を決め直すこと。
          showStatActiveClients && { label: t("dashboard.statActiveClients"), value: t("dashboard.peopleUnit", { count: activeClientCount }), icon: Users, color: 'text-info' },
          showStatMonthSessions && { label: t("dashboard.statMonthSessions"), value: t("dashboard.countUnit", { count: monthBookings.length }), icon: Clock, color: 'text-success' },
          showStatMonthRevenue && { label: t("dashboard.statMonthRevenue"), value: `¥${currentMonthRevenue.toLocaleString()}`, icon: TrendingUp, color: 'text-warning' },
        ].filter((s): s is { label: string; value: string; icon: typeof CalendarDays; color: string } => !!s);
        if (statCards.length === 0) return null;
        return (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6">
            {statCards.map((stat) => (
              <Card key={stat.label} className="card-hover">
                <CardContent className="p-3 sm:p-4">
                  <stat.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${stat.color} mb-1.5 sm:mb-2`} />
                  <p className="text-lg sm:text-2xl font-extrabold truncate">{stat.value}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">{stat.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        );
      })()}

      <div className="space-y-4 sm:space-y-6">
        {/* Today's Schedule - REAL DATA（本日のセッションを最上部に）。ジム設定でオフにできる。 */}
        {showTodaySchedule && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5" />
            {t("dashboard.todaySchedule")}
          </h2>
          {todayBookings.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-center text-sm text-muted-foreground">
                {t("dashboard.noTodayBookings")}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {todayBookings
                .sort((a, b) => a.startTime.localeCompare(b.startTime))
                .map((b) => {
                  const profile = profiles.find((pr) => pr.user_id === b.user_id);
                  const progress = profile
                    ? getBookingProgressIndex(b.id, profile.cycle_start_date, profile.plan, bookingsByUser.get(b.user_id) || [], resolveCycleMonths(profile.plan, tenantPlans), resolveGraceDays(profile.plan, tenantPlans, profile.grace_enabled), resolveCycleUnit(profile.plan, tenantPlans), profile.cycle_start_pinned)
                    : null;

                  // 体験予約(trial-guest)は会員プロフィールが無いため詳細遷移不可。クリック不可にする。
                  const isTrial = b.user_id === "trial-guest";
                  return (
                  <Card key={b.id} className={`card-hover ${profile ? "cursor-pointer" : ""}`} onClick={() => {
                    // Find profile by user_id for navigation
                    if (profile) onSelectClient(profile.user_id);
                  }}>
                    <CardContent className="p-3 sm:p-4 flex items-center gap-3 sm:gap-4">
                      <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold text-xs sm:text-sm shrink-0 ${isTrial ? "bg-muted text-muted-foreground" : "gym-gradient text-primary-foreground"}`}>
                        {/* clientName 先頭が絵文字(🆕)のサロゲートペアでも壊れないよう Array.from で1文字取り出す */}
                        {Array.from(b.clientName)[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{b.clientName}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                            {b.booking_type}
                          </Badge>
                          {progress && (
                            <CourseProgressBadge
                              index={progress.index}
                              total={progress.total}
                              isUnlimited={progress.isUnlimited}
                              isUnconfigured={progress.isUnconfigured}
                              isOverflow={progress.isOverflow}
                              isGraceCarryover={progress.isGraceCarryover}
                              className="mt-0"
                            />
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold">{b.startTime}</p>
                        <p className="text-xs text-muted-foreground">{t("dashboard.minutes60")}</p>
                      </div>
                    </CardContent>
                  </Card>
                  );
                })}
            </div>
          )}
        </section>
        )}

        {/* 体験フォロー待ち（体験CRM）。過去の体験予約で follow_up_status が未対応のまま残っている件数。
            ジム設定でオフにできる。 */}
        {showTrialFollowUpAlert && pendingFollowUps > 0 && onNavigateFollowUps && (
          <section>
            <button type="button" onClick={onNavigateFollowUps} className="w-full text-left">
              <Card className="card-hover border-warning/30">
                <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-warning/15 flex items-center justify-center text-warning shrink-0">
                    <UserCheck className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{t("trialFollowUp.dashboardBanner", { count: pendingFollowUps })}</p>
                    <p className="text-xs text-muted-foreground">{t("trialFollowUp.dashboardBannerHint")}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </button>
          </section>
        )}

        {/* キャンセル待ち＝「予約したかったのに満枠で入れなかった」お客様。
            取りこぼしなので、件数と枠を店に見せる。
            同時1件までの設定のままなら、設定の場所も添える（実態と違うかもしれないため）。 */}
        {WAITLIST_ENABLED && waitingTotal > 0 && (
          <section>
            <Card className="border-warning/30">
              <CardContent className="p-3 sm:p-4 flex items-start gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-warning/15 flex items-center justify-center text-warning shrink-0">
                  <Clock className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm">{t("waitlistAlert.title", { count: waitingTotal })}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {waitingSlots.slice(0, 3).map((s) => t("waitlistAlert.slot", {
                      date: formatJST(new Date(`${s.date}T00:00:00+09:00`), "M/d"),
                      time: s.time.slice(0, 5),
                      count: s.count,
                    })).join("、")}
                    {waitingSlots.length > 3 && t("waitlistAlert.more", { count: waitingSlots.length - 3 })}
                  </p>
                  {showCapacityHint && (
                    <p className="text-xs text-warning mt-1.5">{t("waitlistAlert.capacityHint")}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* 同時に受けられる予約数を、まだ一度も店に聞けていない場合だけ確認する。
            既定は1で、実態が2人以上の店では**空いている枠が「満枠」と出て予約を取りこぼす**。
            2026-08-02 に本番を見たら14テナント全部が既定のままだった。

            値は推測しない（本当に1対1の店で二重予約を通すと、お客様が来たのに
            対応者がいないという、より重い実害になる。mem/features/booking-capacity.md）。
            「1で正しい」も答えとして記録し、二度は聞かない。

            オンボーディングを通った新規店は既に答えているのでここには出ない。
            列が読めない環境（migration 未適用）は undefined になり、やはり出ない
            （保存できないのに聞き続けないため）。 */}
        {tenant?.booking_capacity_confirmed_at === null && (
          <section>
            <Card className="border-primary/30">
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary/15 flex items-center justify-center text-primary shrink-0">
                    <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm">{t("capacityConfirm.title")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("capacityConfirm.body")}</p>
                    <div className="flex items-center gap-2 mt-2.5">
                      <select
                        value={capacityAnswer}
                        onChange={(e) => setCapacityAnswer(Number(e.target.value))}
                        className="h-9 px-2 rounded-md border border-input bg-background text-sm"
                        aria-label={t("capacityConfirm.title")}
                      >
                        {CONFIRM_CAPACITY_OPTIONS.map((n) => (
                          <option key={n} value={n}>{t("settings.trainer.businessHoursCapacityUnit", { count: n })}</option>
                        ))}
                      </select>
                      <Button size="sm" onClick={saveCapacityAnswer} disabled={capacitySaving}>
                        {t("capacityConfirm.save")}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* フォローが必要な顧客（離脱検知）。ジム設定でオフにできる（既定は表示）。 */}
        {showRetentionAlerts && atRiskCustomers.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <UserRoundX className="w-3.5 h-3.5 text-warning" />
              {t("retention.title")}
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                {t("dashboard.countUnit", { count: atRiskCustomers.length })}
              </Badge>
            </h2>
            <div className="space-y-2">
              {atRiskCustomers.slice(0, 10).map((c) => (
                <Card key={c.user_id} className="card-hover cursor-pointer border-warning/30" onClick={() => onSelectClient(c.user_id)}>
                  <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-warning/15 flex items-center justify-center text-warning font-bold text-xs sm:text-sm shrink-0">
                      {(c.name || "?")[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.reason === "lapsed"
                          ? t("retention.lapsed", { days: c.days })
                          : t("retention.neverBooked")}
                      </p>
                    </div>
                    {onMessageClient && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-8"
                        onClick={(e) => {
                          e.stopPropagation(); // 行タップ（顧客詳細）と分離
                          onMessageClient(c.user_id);
                        }}
                      >
                        <MessageCircle className="w-3.5 h-3.5 mr-1" />
                        {t("retention.message")}
                      </Button>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              ))}
              {atRiskCustomers.length > 10 && (
                <p className="text-[11px] text-muted-foreground text-center pt-1">
                  {t("retention.more", { count: atRiskCustomers.length - 10 })}
                </p>
              )}
            </div>
          </section>
        )}

        {/* 更新が近い顧客（プラン更新リマインド）。ジム設定でオフにできる。 */}
        {showRenewalAlerts && renewalSoon.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5 text-info" />
              {t("renewal.title")}
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                {t("dashboard.countUnit", { count: renewalSoon.length })}
              </Badge>
            </h2>
            <div className="space-y-2">
              {renewalSoon.slice(0, 10).map((c) => {
                const when = c.days === 0 ? t("renewal.soonToday") : t("renewal.soon", { days: c.days });
                const detail = c.isUnlimited
                  ? t("renewal.unlimited")
                  : c.remaining != null
                    ? t("renewal.remaining", { count: c.remaining })
                    : "";
                return (
                  <Card key={c.user_id} className="card-hover cursor-pointer border-info/30" onClick={() => onSelectClient(c.user_id)}>
                    <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                      <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-info/15 flex items-center justify-center text-info font-bold text-xs sm:text-sm shrink-0">
                        {(c.name || "?")[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{when}{detail}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                );
              })}
              {renewalSoon.length > 10 && (
                <p className="text-[11px] text-muted-foreground text-center pt-1">
                  {t("retention.more", { count: renewalSoon.length - 10 })}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Counseling Responses（回答が1件でもある場合のみ表示。カウンセリングシートを
            使わないジムに「まだありません」の空欄を出さない。回答が来れば自動で表示される）。
            ジム設定でオフにもできる。 */}
        {showCounselingResponses && !counselingLoading && counselingResponses.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5" />
              {t("dashboard.counselingSection")}
              {counselingUnread > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                  {t("dashboard.unreadCount", { count: counselingUnread })}
                </Badge>
              )}
            </h2>
            <CounselingResponseList />
          </section>
        )}

        {/*
          入金の記録がまだ1件も無いジム向けの案内。
          2026-08-08 に売上を「定価×サイクル開始日の推計」から「実際に受け取った記録」へ
          切り替えたため、記録を始めるまでグラフも今月の売上も 0 になる。
          何も言わないと「壊れた」と読まれるので、切り替えたことを明示する。
          売上系の表示を両方オフにしているジムには出さない。
        */}
        {!hasAnyPaymentRecord && (showRevenueChart || showStatMonthRevenue) && (
          <section>
            <Card className="border-info/30">
              <CardContent className="p-3 sm:p-4">
                <p className="text-sm font-bold mb-1">{t("member.revenueEmptyTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("member.revenueEmptyBody")}</p>
              </CardContent>
            </Card>
          </section>
        )}

        {/*
          今月の入金が未記録の在籍会員。
          ⚠️ **「未収」「滞納」とは書かない。** 記録し忘れているだけの可能性があり、
             督促の根拠として出しているわけではない（画面の文言も t("member.unrecorded*") 側で統一）。
          記録を1件も付けていないジムには出さない。全員が並ぶだけで意味が無いため。
        */}
        {hasAnyPaymentRecord && unrecordedThisMonth.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5 text-warning" />
              {t("member.unrecordedTitle")}
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 ml-1">
                {t("dashboard.countUnit", { count: unrecordedThisMonth.length })}
              </Badge>
            </h2>
            <div className="space-y-2">
              {unrecordedThisMonth.slice(0, 10).map((m) => (
                <Card key={m.user_id} className="card-hover cursor-pointer" onClick={() => onSelectClient(m.user_id)}>
                  <CardContent className="p-3 sm:p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {m.planName}
                        {m.expectedYen ? ` ・ ${formatYen(m.expectedYen)}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              ))}
              {unrecordedThisMonth.length > 10 && (
                <p className="text-[11px] text-muted-foreground text-center pt-1">
                  {t("retention.more", { count: unrecordedThisMonth.length - 10 })}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">{t("member.unrecordedNote")}</p>
            </div>
          </section>
        )}

        {/* Revenue Chart。ジム設定でオフにできる。 */}
        {showRevenueChart && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            {t("dashboard.revenueSection")}
          </h2>
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="h-44 sm:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(30, 10%, 92%)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(220, 6%, 55%)" axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(220, 6%, 55%)" axisLine={false} tickLine={false} tickFormatter={(v) => `${v / 10000}${t("dashboard.monthMan")}`} width={40} />
                    <Tooltip
                      formatter={(value: number) => [`¥${value.toLocaleString()}`, t("dashboard.revenueLabel")]}
                      contentStyle={{
                        background: 'hsl(0, 0%, 100%)',
                        border: 'none',
                        borderRadius: '12px',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                        fontSize: '12px',
                      }}
                    />
                    <Bar dataKey="revenue" fill="hsl(174, 65%, 50%)" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </section>
        )}

        {/* 稼働率ヒートマップ（曜日×時間帯）。ジム設定でオフにできる。 */}
        {showUtilizationHeatmap && <TrainerUtilizationHeatmap />}

      </div>
    </div>
  );
};

export default TrainerDashboard;
