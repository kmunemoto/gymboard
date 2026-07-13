import { Users, CalendarDays, TrendingUp, Clock, BarChart3, ClipboardList, UserRoundX, ChevronRight, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { useAllCustomerProfiles, useProfile } from "@/hooks/useProfile";
import { useAllBookings } from "@/hooks/useBookings";
import { formatJST, getJSTNow } from "@/lib/timezone";
import { addDays, startOfDay } from "date-fns";
import CounselingResponseList from "./CounselingResponseList";
import { useCounselingResponses } from "@/hooks/useCounselingResponses";
import CourseProgressBadge from "./CourseProgressBadge";
import { getBookingProgressIndex, resolveCycleMonths, resolveGraceDays, type BookingForProgress } from "@/lib/courseProgress";
import { computePlanUsage, resolvePlanUsageInput } from "@/lib/planUsage";
import { RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useTenant } from "@/hooks/useTenant";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

interface TrainerDashboardProps {
  onSelectClient: (clientId: string) => void;
  /** 離脱アラートの「声かけ」: 指定顧客との会話を開いた状態でメッセージ画面へ */
  onMessageClient?: (clientId: string) => void;
}

type RevenueProfile = {
  user_id: string;
  plan: string | null;
  cycle_start_date: string | null;
};

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

const getRevenueCycleStartDates = (
  profile: RevenueProfile,
  userBookings: BookingForProgress[],
  todayKey: string,
  now: Date,
) => {
  const starts = new Set<string>();
  const bookingDates = userBookings
    .filter((b) => {
      if (b.status === "キャンセル済み") return false;
      return new Date(b.booking_date) <= now;
    })
    .map((b) => b.booking_date.slice(0, 10))
    .sort();

  if (!profile.cycle_start_date || bookingDates.length === 0) return starts;

  if (profile.cycle_start_date <= todayKey) {
    starts.add(profile.cycle_start_date);
  }

  let nextStart = profile.cycle_start_date;
  while (nextStart) {
    const windowStart = addMonthsToDateKey(nextStart, -1);
    const previousStart = bookingDates.find((date) => date >= windowStart && date < nextStart);
    if (!previousStart || starts.has(previousStart)) break;
    starts.add(previousStart);
    nextStart = previousStart;
  }

  return starts;
};

const TrainerDashboard = ({ onSelectClient, onMessageClient }: TrainerDashboardProps) => {
  const { t } = useTranslation();
  const { profiles, loading } = useAllCustomerProfiles();
  const { bookings, loading: bookingsLoading } = useAllBookings();
  const { unreadCount: counselingUnread } = useCounselingResponses();
  const { profile: trainerProfile } = useProfile();
  const { plans: tenantPlans } = useTenant();
  const trainerName = trainerProfile?.display_name || t("dashboard.trainerFallback");

  const today = formatJST(new Date(), "yyyy-MM-dd");
  // 本日のスケジュールには体験予約（user_id === "trial-guest"）も含める。
  // トレーナーが当日その枠に対応するため予定として表示する必要がある。
  // （月間セッション数・売上の集計では体験は無料/非会員のため引き続き除外する）
  const todayBookings = bookings.filter(
    (b) => b.date === today && b.status !== "キャンセル済み" && b.user_id !== "blocked",
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
  //  1回目のトレーニング日 = 支払い日として計上する。
  //  今期は profiles.cycle_start_date、過去月は予約履歴から「次サイクル開始日の1ヶ月前以降で最初の予約」を逆算する。
  //  未来の1回目トレーニング日は、当日になるまで売上に含めない。
  const revenueByMonth = useMemo(() => {
    const now = new Date();
    const map = new Map<string, number>();
    profiles.forEach((p) => {
      if (!p.plan || !p.cycle_start_date) return;
      const matched = tenantPlans.find((tp) => tp.plan_name === p.plan);
      const price = matched?.price || 0;
      if (!price) return;

      const cycleStarts = getRevenueCycleStartDates(p, bookingsByUser.get(p.user_id) || [], today, now);
      cycleStarts.forEach((dateKey) => {
        const monthKey = dateKey.slice(0, 7);
        map.set(monthKey, (map.get(monthKey) || 0) + price);
      });
    });
    return map;
  }, [profiles, bookingsByUser, today, tenantPlans]);

  const currentMonthRevenue = revenueByMonth.get(currentMonth) || 0;

  const revenueData = getRecentMonths(today).map((monthStart) => {
    const monthKey = monthStart.slice(0, 7);
    const monthNumber = Number(monthStart.slice(5, 7));
    return { month: t("dashboard.monthLabel", { month: monthNumber }), revenue: revenueByMonth.get(monthKey) || 0 };
  });

  // フォローが必要な顧客（離脱検知）:
  //  最終来店から INACTIVE_DAYS 日以上経過し、今後の予約が無い顧客を抽出。
  //  既存テーブル（bookings / profiles）の派生計算のみ。スキーマ変更なし。
  const INACTIVE_DAYS = 14;
  const atRiskCustomers = useMemo(() => {
    const now = new Date();
    // ユーザーごとの最終来店日（過去の非キャンセル予約の最大日）と、今後予約の有無
    const visit = new Map<string, { last: string | null; upcoming: boolean }>();
    bookings.forEach((b) => {
      if (b.status === "キャンセル済み" || b.user_id === "blocked" || b.user_id === "trial-guest") return;
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
      if (!p.cycle_start_date || !p.plan) return;
      const tenantPlan = tenantPlans.find((tp) => tp.plan_name === p.plan) ?? null;
      const input = resolvePlanUsageInput(p.plan, tenantPlan, p.cycle_start_date);
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

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4 sm:mb-6">
        {[
          { label: t("dashboard.statTodaySessions"), value: t("dashboard.countUnit", { count: todayBookings.length }), icon: CalendarDays, color: 'text-accent' },
          { label: t("dashboard.statActiveClients"), value: t("dashboard.peopleUnit", { count: profiles.length }), icon: Users, color: 'text-info' },
          { label: t("dashboard.statMonthSessions"), value: t("dashboard.countUnit", { count: monthBookings.length }), icon: Clock, color: 'text-success' },
          { label: t("dashboard.statMonthRevenue"), value: `¥${currentMonthRevenue.toLocaleString()}`, icon: TrendingUp, color: 'text-warning' },
        ].map((stat) => (
          <Card key={stat.label} className="card-hover">
            <CardContent className="p-3 sm:p-4">
              <stat.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${stat.color} mb-1.5 sm:mb-2`} />
              <p className="text-lg sm:text-2xl font-extrabold truncate">{stat.value}</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 leading-tight">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4 sm:space-y-6">
        {/* Today's Schedule - REAL DATA（本日のセッションを最上部に） */}
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
                    ? getBookingProgressIndex(b.id, profile.cycle_start_date, profile.plan, bookingsByUser.get(b.user_id) || [], resolveCycleMonths(profile.plan, tenantPlans), resolveGraceDays(profile.plan, tenantPlans, profile.grace_enabled))
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

        {/* フォローが必要な顧客（離脱検知） */}
        {atRiskCustomers.length > 0 && (
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

        {/* 更新が近い顧客（プラン更新リマインド） */}
        {renewalSoon.length > 0 && (
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

        {/* Counseling Responses */}
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

        {/* Revenue Chart */}
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

      </div>
    </div>
  );
};

export default TrainerDashboard;
