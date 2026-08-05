import { lazy, useEffect, useRef, useState } from "react";
import { TrendingDown, TrendingUp, CalendarDays, Flame, Target, ScanLine, BarChart3, ChevronRight, Dumbbell, Share2, Weight, Calendar as CalendarIcon, Save, Camera, Star, X } from "lucide-react";
import { openExternalUrl } from "@/lib/nativeBridge";
import { sendLineMessage } from "@/lib/lineNotify";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import LazyBoundary from "@/components/LazyBoundary";
// グラフ(recharts ~400KB)は遅延読込し、ホームの初期表示を軽くする
const ProgressCharts = lazy(() => import("./ProgressCharts"));
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { CustomerTab } from "./CustomerView";
import { useProfile } from "@/hooks/useProfile";
import { useMyBookings, SAME_DAY_FORFEIT_STATUS } from "@/hooks/useBookings";
import { useMeasurements } from "@/hooks/useMeasurements";
import { useAuth } from "@/contexts/AuthContext";
import { useStreak } from "@/hooks/useStreak";
import { format, parseISO } from "date-fns";
import { getJSTNow, formatJST } from "@/lib/timezone";
import { ja } from "date-fns/locale";
import { formatDate } from "@/lib/dateFormat";
import { supabase } from "@/integrations/supabase/client";
import { getCycleWindow, resolveCycleMonths } from "@/lib/courseProgress";
import WorkoutShareModal from "./WorkoutShareModal";
import { buildSession, type RawWorkout } from "@/lib/workoutShare";
import { getMuscleGroup, summarizeMuscleGroups } from "@/lib/muscleGroup";
import { useTenant } from "@/hooks/useTenant";
import PlanUsageCard from "./PlanUsageCard";
import StreakCard from "./StreakCard";
import MilestoneGoalCard from "./MilestoneGoalCard";
import {
  STREAK_ENABLED,
  MONTHLY_REPORT_ENABLED,
  WORKOUT_LOG_ENABLED,
  POSTURE_ENABLED,
  BODY_METRICS_ENABLED,
} from "@/lib/featureFlags";
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";

// Fallback for legacy Salute plans when tenant_plans has no match
const fallbackPlanMaxSessions: Record<string, number> = {
  '月4回': 4,
  '月6回': 6,
  '月8回': 8,
  '通い放題': 15,
};

const CustomerHome = ({ onNavigate }: { onNavigate?: (tab: CustomerTab) => void }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile, loading } = useProfile();
  const { plans: tenantPlans, tenant } = useTenant();
  const { bookings, loading: bookingsLoading } = useMyBookings();
  const { chartData, latest, loading: metricsLoading, saveMeasurement } = useMeasurements(user?.id);
  const { currentStreak, bestStreak, hasFutureBookingThisWeek, loading: streakLoading } = useStreak(user?.id);
  const streakNotifiedRef = useRef(false);
  const [latestWorkouts, setLatestWorkouts] = useState<RawWorkout[]>([]);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [totalSessions, setTotalSessions] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [measurementDate, setMeasurementDate] = useState<Date>(getJSTNow());
  const [inputWeight, setInputWeight] = useState("");
  const [inputBodyFat, setInputBodyFat] = useState("");
  const [savingMeasurement, setSavingMeasurement] = useState(false);

  // Fetch all workouts (for PR + latest session) and total sessions count
  useEffect(() => {
    if (!user) return;
    supabase
      .from("workouts")
      .select("id, workout_date, weight, reps, sets, exercise_id, exercises(name)")
      .eq("user_id", user.id)
      .order("workout_date", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (!data) return;
        const rows: RawWorkout[] = data.map((w: any) => ({
          id: w.id,
          workout_date: w.workout_date,
          weight: w.weight,
          reps: w.reps,
          sets: w.sets,
          exercise_id: w.exercise_id,
          exercise_name: w.exercises?.name || t("common.unknown"),
        }));
        setLatestWorkouts(rows);
        setLatestDate(rows.length > 0 ? rows[0].workout_date : null);
      });

    const nowIso = new Date().toISOString();
    // 同日キャンセル消化(SAME_DAY_FORFEIT_STATUS)はプラン消化数には数えるが、
    // 実際には来店していないため「累計トレーニング回数」（達成バッジ・シェア画像用）
    // には含めない。
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .neq("status", "キャンセル済み")
      .neq("status", SAME_DAY_FORFEIT_STATUS)
      .lt("booking_date", nowIso)
      .then(({ count }) => setTotalSessions(count || 0));
  }, [user, t]);

  // 口コミ依頼バナー（累計来店 REVIEW_PROMPT_MILESTONE 回目の節目で、ジムに
  // google_review_url が設定されている場合のみ、一度だけ表示する）。
  const REVIEW_PROMPT_MILESTONE = 10;
  const [reviewPrompted, setReviewPrompted] = useState(true); // profile読込前は誤表示しないようtrue始まり
  const [reviewActionLoading, setReviewActionLoading] = useState(false);
  useEffect(() => {
    setReviewPrompted(!!(profile as any)?.review_prompted_at);
  }, [profile]);

  const markReviewPrompted = async () => {
    if (!user) return;
    setReviewActionLoading(true);
    await supabase.from("profiles").update({ review_prompted_at: new Date().toISOString() } as any).eq("user_id", user.id);
    setReviewActionLoading(false);
    setReviewPrompted(true);
  };

  const showReviewBanner =
    !loading && totalSessions >= REVIEW_PROMPT_MILESTONE && !!tenant?.google_review_url && !reviewPrompted;

  const handleOpenReview = () => {
    if (tenant?.google_review_url) openExternalUrl(tenant.google_review_url);
    markReviewPrompted();
  };

  const latestSession = latestDate ? buildSession(latestWorkouts, latestDate) : null;

  const displayName = profile?.display_name || t("common.guest");
  const currentPlan = profile?.plan;
  const hasPlan = !!currentPlan && currentPlan !== '初回無料体験';

  // Filter future bookings only — based on JST wall clock
  const now = getJSTNow();
  const todayStr = formatJST(new Date(), "yyyy-MM-dd");
  const nowTimeStr = formatJST(new Date(), "HH:mm");

  const futureBookings = bookings.filter((b) => {
    // 同日キャンセル消化は「来ない予約」なので次回予約カードには出さない
    // （プラン消化数には別途 courseProgress.ts 側で正しく数えられる）。
    if (b.status === "キャンセル済み" || b.status === SAME_DAY_FORFEIT_STATUS) return false;
    if (b.date > todayStr) return true;
    if (b.date === todayStr && b.startTime > nowTimeStr) return true;
    return false;
  });

  const nextBooking = futureBookings.length > 0 ? futureBookings[0] : null;

  // Compute cycle-based session count for nextBooking
  const tenantPlanMatch = currentPlan ? tenantPlans.find((p) => p.plan_name === currentPlan) : null;
  const tenantMax = tenantPlanMatch?.max_sessions;
  // null max_sessions on tenant plan = unlimited (default to 15 like legacy 通い放題)
  const resolvedMax = tenantPlanMatch
    ? (tenantMax == null ? 15 : tenantMax)
    : (currentPlan ? (fallbackPlanMaxSessions[currentPlan] || 4) : 0);
  const maxSessions = hasPlan ? resolvedMax : 0;

  const nextBookingCycle = nextBooking ? getCycleWindow(profile?.cycle_start_date, parseISO(nextBooking.date), resolveCycleMonths(currentPlan, tenantPlans)) : null;

  const cycleBookings = (() => {
    if (!nextBookingCycle) return [];
    return bookings
      .filter((b) => {
        // 「今回n/m回目」のnを出すための消化数カウント。同日キャンセル消化
        // (SAME_DAY_FORFEIT_STATUS) はプラン消化数として数える対象なので、
        // ここではあえて除外しない（courseProgress.ts と同じ扱い）。
        if (b.status === "キャンセル済み") return false;
        const d = parseISO(b.date);
        return d >= nextBookingCycle.start && d < nextBookingCycle.end;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  })();

  const rawOrdinal = nextBooking
    ? cycleBookings.findIndex((b) => b.id === nextBooking.id) + 1
    : 0;
  const nextBookingOrdinal = (rawOrdinal > 0 && maxSessions > 0)
    ? ((rawOrdinal - 1) % maxSessions) + 1
    : rawOrdinal;

  // Streak LINE notification
  useEffect(() => {
    if (!user || streakLoading || streakNotifiedRef.current || currentStreak < 4) return;
    const checkAndNotify = async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("last_streak_notified, line_user_id")
        .eq("user_id", user.id)
        .single();
      if (!prof?.line_user_id) return;

      const lastNotified = (prof as any).last_streak_notified || 0;
      const milestones = [4, 8, 12];
      const hitMilestone = milestones.find(m => currentStreak >= m && lastNotified < m);
      const isBestRecord = currentStreak > lastNotified && currentStreak > (profile?.best_streak || 0);

      let message = "";
      if (hitMilestone) {
        if (hitMilestone === 4) message = t("home.streakMilestone4");
        else if (hitMilestone === 8) message = t("home.streakMilestone8");
        else if (hitMilestone === 12) message = t("home.streakMilestone12");
      } else if (isBestRecord) {
        message = t("home.streakBest", { count: currentStreak });
      }

      if (message && currentStreak > lastNotified) {
        streakNotifiedRef.current = true;
        try {
          // 自分自身への通知。`userId`（LINE の ID）を渡していたが Edge Function 側は
          // そのキーを読んでおらず、**宛先なしで skip され続けていた**（誰も気づいていない）。
          await sendLineMessage({ user_id: user.id, message }, "連続来店の記録通知");
          await supabase
            .from("profiles")
            .update({ last_streak_notified: currentStreak } as any)
            .eq("user_id", user.id);
        } catch (e) {
          // fire-and-forget
        }
      }
    };
    checkAndNotify();
  }, [user, currentStreak, streakLoading]);

  if (loading || bookingsLoading || metricsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 text-accent" />
      </div>
    );
  }

  // Format next booking date for display
  const formatBookingDate = (b: typeof nextBooking) => {
    if (!b) return "";
    const d = parseISO(b.date);
    return `${formatDate(d, "monthDayDow")} ${b.startTime} - ${b.endTime}`;
  };

  // Compute weight/fat changes from first to latest
  const first = chartData.length > 0 ? chartData[0] : null;
  const weightChange = latest && first && latest.weight != null && first.weight != null
    ? (latest.weight - first.weight).toFixed(1) : null;
  const fatChange = latest && first && latest.body_fat != null && first.bodyFat != null
    ? (latest.body_fat - (first.bodyFat as number)).toFixed(1) : null;

  const greetingHeader = (
    <div className="gym-gradient rounded-2xl p-5 text-primary-foreground relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-accent/10 -translate-y-8 translate-x-8" />
        <div className="absolute bottom-0 left-0 w-20 h-20 rounded-full bg-accent/5 translate-y-6 -translate-x-4" />
        <div className="relative">
          <p className="text-sm opacity-75 flex items-center gap-1">{t("home.greeting")} <Flame className="w-3.5 h-3.5" /></p>
          <h1 className="text-xl font-bold mt-1">{t("home.greetingName", { name: displayName })}</h1>
          <div className="flex items-center gap-4 mt-4">
            <div className="flex items-center gap-1.5 bg-primary-foreground/15 rounded-full px-3 py-1">
              <Target className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{t("home.sessionsAchieved", { count: bookings.length })}</span>
            </div>
            {/* STREAK_ENABLED=false でもここだけ残っていた漏れを塞ぐ */}
            {STREAK_ENABLED && (
              <div className="flex items-center gap-1.5 bg-primary-foreground/15 rounded-full px-3 py-1">
                <Flame className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">{currentStreak > 0 ? t("home.weeksStreak", { count: currentStreak }) : t("home.keepingUp")}</span>
              </div>
            )}
          </div>
        </div>
    </div>
  );

  const nextBookingSection = (
    <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5" />
          {t("home.nextBooking")}
        </h2>
        {nextBooking ? (
          <Card className="card-hover border-l-4 border-l-accent">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-base glass-stat">{formatBookingDate(nextBooking)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {nextBooking.booking_type === "初回無料体験" ? t("home.freeTrial") : t("home.training")}
                  </p>
                  {hasPlan && maxSessions > 0 && (
                    <p className="text-xs font-semibold text-accent mt-1.5">
                      {t("home.sessionOrdinal", { ordinal: nextBookingOrdinal > 0 ? String(nextBookingOrdinal) : "?", max: maxSessions } as any) as string}
                    </p>
                  )}
                </div>
                <div className="w-12 h-12 rounded-xl accent-gradient flex items-center justify-center pulse-glow">
                  <CalendarDays className="w-5 h-5 text-accent-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 text-center text-sm text-muted-foreground">
              {t("home.noBookings")}
            </CardContent>
          </Card>
        )}
    </section>
  );

  return (
    <div className="px-4 py-4 space-y-5 slide-up">
      {/* 1. Greeting */}
      {greetingHeader}

      {/* 2. Next Booking */}
      {nextBookingSection}

      {/* 2.5 プラン消化状況（残り予約回数） */}
      <PlanUsageCard
        planName={profile?.plan}
        cycleStartDate={profile?.cycle_start_date}
        tenantPlans={tenantPlans}
        bookings={bookings.map((b) => ({ booking_date: `${b.date}T${b.startTime}:00+09:00`, status: b.status }))}
        graceEnabled={profile?.grace_enabled}
        showUsagePeriod={profile?.show_usage_period}
      />

      {/* 2.6 3ヶ月目標（棚卸し目標）: 設定しているお客様にのみ表示 */}
      <MilestoneGoalCard milestoneGoal={profile?.milestone_goal} />

      {/* 3. Streak */}
      {STREAK_ENABLED && !streakLoading && (currentStreak > 0 || bestStreak > 0) && (
        <StreakCard
          currentStreak={currentStreak}
          bestStreak={bestStreak}
          hasFutureBookingThisWeek={hasFutureBookingThisWeek}
        />
      )}

      {/* 3.5 口コミ依頼バナー */}
      {showReviewBanner && (
        <Card className="bg-accent/5 border-accent/30 relative">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
              <Star className="w-4 h-4 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">{t("home.reviewPromptTitle", { count: totalSessions })}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("home.reviewPromptDesc")}</p>
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={handleOpenReview} disabled={reviewActionLoading} className="h-8 text-xs">
                  <Star className="w-3.5 h-3.5 mr-1" />
                  {t("home.reviewPromptCta")}
                </Button>
                <Button size="sm" variant="ghost" onClick={markReviewPrompted} disabled={reviewActionLoading} className="h-8 text-xs">
                  {t("home.reviewPromptLater")}
                </Button>
              </div>
            </div>
            <button
              type="button"
              onClick={markReviewPrompted}
              disabled={reviewActionLoading}
              className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={t("common.close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </CardContent>
        </Card>
      )}

      {/* 4. Weight / Body Fat Cards */}
      {BODY_METRICS_ENABLED && latest && (latest.weight != null || latest.body_fat != null) && (
        <div className="grid grid-cols-2 gap-3">
          {latest.weight != null && (
            <Card className="card-hover">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-extrabold glass-stat">{latest.weight}<span className="text-sm font-medium text-muted-foreground">kg</span></p>
                <p className="text-xs text-muted-foreground mt-1">{t("home.currentWeight")}</p>
                {weightChange && (
                  <div className="flex items-center justify-center gap-1 mt-1.5">
                    {parseFloat(weightChange) <= 0 ? (
                      <TrendingDown className="w-3 h-3 text-success" />
                    ) : (
                      <TrendingUp className="w-3 h-3 text-destructive" />
                    )}
                    <span className={`text-xs font-bold ${parseFloat(weightChange) <= 0 ? 'text-success' : 'text-destructive'}`}>{weightChange}kg</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {latest.body_fat != null && (
            <Card className="card-hover">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-extrabold glass-stat">{latest.body_fat}<span className="text-sm font-medium text-muted-foreground">%</span></p>
                <p className="text-xs text-muted-foreground mt-1">{t("home.bodyFat")}</p>
                {fatChange && (
                  <div className="flex items-center justify-center gap-1 mt-1.5">
                    {parseFloat(fatChange) <= 0 ? (
                      <TrendingDown className="w-3 h-3 text-success" />
                    ) : (
                      <TrendingUp className="w-3 h-3 text-destructive" />
                    )}
                    <span className="text-xs font-bold" style={{ color: "#FF8C42" }}>{fatChange}%</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* 4b. Measurement Input */}
      {BODY_METRICS_ENABLED && (
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <Weight className="w-3.5 h-3.5" />
          {t("home.recordMeasurement")}
        </h2>
        <Card>
          <CardContent className="p-3 sm:p-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">{t("home.measureDate")}</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full h-11 justify-start text-left font-normal", !measurementDate && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {measurementDate ? formatDate(measurementDate, "yearMonthDay") : t("home.selectDate")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={measurementDate}
                    onSelect={(d) => d && setMeasurementDate(d)}
                    disabled={(date) => date > getJSTNow()}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">体重 (kg)</label>
                <Input type="number" inputMode="decimal" step="0.1" placeholder={latest?.weight?.toString() || "60.0"} value={inputWeight} onChange={(e) => setInputWeight(e.target.value)} className="h-11" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">体脂肪率 (%)</label>
                <Input type="number" inputMode="decimal" step="0.1" placeholder={latest?.body_fat?.toString() || "20.0"} value={inputBodyFat} onChange={(e) => setInputBodyFat(e.target.value)} className="h-11" />
              </div>
            </div>
            <Button
              className="w-full"
              disabled={savingMeasurement || (!inputWeight && !inputBodyFat)}
              onClick={async () => {
                setSavingMeasurement(true);
                const dateStr = format(measurementDate, "yyyy-MM-dd");
                const w = inputWeight ? parseFloat(inputWeight) : null;
                const f = inputBodyFat ? parseFloat(inputBodyFat) : null;
                const ok = await saveMeasurement(dateStr, w, f);
                if (ok) { setInputWeight(""); setInputBodyFat(""); setMeasurementDate(getJSTNow()); }
                setSavingMeasurement(false);
              }}
            >
              <Save className="w-4 h-4 mr-1" />
              {savingMeasurement ? "保存中..." : "保存"}
            </Button>
          </CardContent>
        </Card>
      </section>
      )}

      {/* 5. Progress Charts（遅延読込。本体もデータ到着まで null を描画するため
          fallback も null にして読込中のレイアウトを本来の初期状態と一致させる） */}
      {WORKOUT_LOG_ENABLED && (
        <LazyBoundary fallback={null}>
          <ProgressCharts />
        </LazyBoundary>
      )}

      {/* 6. Latest Workout */}
      {WORKOUT_LOG_ENABLED && latestSession && latestSession.exerciseCount > 0 && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Dumbbell className="w-3.5 h-3.5" />
            {t("home.latestWorkout")}
          </h2>
          <div
            onClick={() => onNavigate?.("training")}
            className="rounded-2xl p-6 cursor-pointer transition active:scale-[0.99]"
            style={{ backgroundColor: "#1A1A1A" }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-white font-bold text-lg">
                  {formatJST(latestSession.date, "M月d日（E）", { locale: ja })}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#999" }}>
                  {summarizeMuscleGroups(latestSession.exercises.map((e) => e.exercise_name))}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShareOpen(true);
                }}
                className="w-9 h-9 rounded-lg flex items-center justify-center transition hover:opacity-80"
                style={{ backgroundColor: "rgba(10, 186, 181, 0.15)", color: "#0ABAB5" }}
                aria-label={t("common.share")}
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>

            {/* Stats row */}
            <div className="flex items-end justify-between mb-5">
              <div className="flex-1 text-center">
                <p className="text-white font-extrabold text-2xl leading-none">
                  {latestSession.exerciseCount}
                </p>
                <p className="text-[11px] mt-1.5" style={{ color: "#888" }}>{t("home.exercisesUnit")}</p>
              </div>
              <div className="w-px h-10 self-center" style={{ backgroundColor: "#333" }} />
              <div className="flex-1 text-center">
                <p className="text-white font-extrabold text-2xl leading-none">
                  {latestSession.totalSets}
                </p>
                <p className="text-[11px] mt-1.5" style={{ color: "#888" }}>{t("home.setsUnit")}</p>
              </div>
              <div className="w-px h-10 self-center" style={{ backgroundColor: "#333" }} />
              <div className="flex-1 text-center">
                <p className="font-extrabold text-2xl leading-none" style={{ color: "#0ABAB5" }}>
                  {latestSession.totalVolume.toLocaleString()}
                  <span className="text-xs font-medium ml-0.5" style={{ color: "#888" }}>kg</span>
                </p>
                <p className="text-[11px] mt-1.5" style={{ color: "#888" }}>{t("home.totalVolume")}</p>
              </div>
            </div>

            {/* Exercise list */}
            <div className="pt-4 space-y-2" style={{ borderTop: "1px solid #333" }}>
              {latestSession.exercises.slice(0, 3).map((ex) => {
                const topSet = ex.sets.reduce((a, b) => (b.weight > a.weight ? b : a), ex.sets[0]);
                return (
                  <div key={ex.exercise_id} className="flex items-center justify-between text-xs">
                    <span className="text-white truncate pr-2 flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{ex.exercise_name}</span>
                      <span
                        style={{
                          backgroundColor: "rgba(10, 186, 181, 0.15)",
                          color: "#0ABAB5",
                          fontSize: "10px",
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: "4px",
                          lineHeight: 1.4,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {getMuscleGroup(ex.exercise_name)}
                      </span>
                    </span>
                    <span style={{ color: "#888" }} className="shrink-0">
                      {topSet.weight}kg × {topSet.reps}
                    </span>
                  </div>
                );
              })}
              {latestSession.exercises.length > 3 && (
                <p className="text-xs text-center pt-1" style={{ color: "#888" }}>
                  {t("home.moreExercises", { count: latestSession.exercises.length - 3 })}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 7. Cycle Report Card */}
      {MONTHLY_REPORT_ENABLED && (
      <section>
        <Card className="card-hover border-l-4 border-l-accent cursor-pointer" onClick={() => onNavigate?.("report")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl accent-gradient flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-accent-foreground" />
                </div>
                <div>
                  <p className="font-bold text-sm flex items-center gap-1.5"><BarChart3 className="w-4 h-4" />{t("home.thisReport")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(() => {
                       const currentCycle = getCycleWindow(profile?.cycle_start_date, now, resolveCycleMonths(currentPlan, tenantPlans));
                      if (!currentCycle) return t("home.checkData");
                      const cycleVisited = bookings.filter(b => {
                        // 同日キャンセル消化は実際には来店していないため「来店◯回」に含めない
                        if (b.status === "キャンセル済み" || b.status === SAME_DAY_FORFEIT_STATUS) return false;
                        const d = parseISO(b.date);
                        const bTime = new Date(`${b.date}T${b.endTime || "00:00"}`);
                        return d >= currentCycle.start && d < currentCycle.end && bTime < now;
                      }).length;
                      const parts: string[] = [];
                      if (cycleVisited > 0) parts.push(t("home.visitsCount", { count: cycleVisited }));
                      if (latest && latest.weight != null && weightChange) parts.push(t("home.weightChange", { change: (parseFloat(weightChange) <= 0 ? '' : '+') + weightChange }));
                      return parts.length > 0 ? parts.join(" / ") : t("home.checkData");
                    })()}
                  </p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </section>
      )}

      {/* 7.5 Body Progress Photos (before/after) */}
      {WORKOUT_LOG_ENABLED && (
      <section>
        <Card className="card-hover border-l-4 border-l-accent cursor-pointer" onClick={() => onNavigate?.("photos")}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl accent-gradient flex items-center justify-center">
                  <Camera className="w-5 h-5 text-accent-foreground" />
                </div>
                <div>
                  <p className="font-bold text-sm flex items-center gap-1.5"><Camera className="w-4 h-4" />{t("home.bodyProgress")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t("home.bodyProgressDesc")}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </section>
      )}

      {/* 8. Posture Check CTA */}
      {POSTURE_ENABLED && (
      <section>
        <Button
          variant="outline"
          className="w-full h-14 text-base font-bold gap-2"
          onClick={() => onNavigate?.("posture")}
        >
          <ScanLine className="w-5 h-5" />
          {t("home.postureCheck")}
        </Button>
      </section>
      )}

      <WorkoutShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        session={latestSession}
        streakWeeks={currentStreak}
        totalSessions={totalSessions}
      />
    </div>
  );
};

export default CustomerHome;
