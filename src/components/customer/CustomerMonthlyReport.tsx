import { useState, useEffect, useMemo } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, TrendingDown, TrendingUp, Minus, Award, Utensils, Bone, MessageSquare, Sparkles, Loader2, CalendarDays, Flame, Dumbbell } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { useStreak } from "@/hooks/useStreak";
import { supabase } from "@/integrations/supabase/client";
import { format, addMonths, parseISO, differenceInDays, isBefore } from "date-fns";
import { ja } from "date-fns/locale";
import { getJSTNow, toJSTDate, formatJST } from "@/lib/timezone";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend } from "recharts";
import MuscleGroupBadge from "./MuscleGroupBadge";

const planMaxSessions: Record<string, number> = {
  '月4回': 4, '月6回': 6, '月8回': 8, '通い放題': 15,
};

const PIE_COLORS = ["hsl(174, 65%, 50%)", "hsl(210, 40%, 58%)", "hsl(150, 40%, 50%)"];

interface Props {
  onBack: () => void;
}

/** Given a cycle_start_date and a target date, find the cycle window containing that date */
const getCycleWindow = (cycleStartDate: string, targetDate: Date) => {
  let cycleStart = parseISO(cycleStartDate);
  while (addMonths(cycleStart, 1) <= targetDate) {
    cycleStart = addMonths(cycleStart, 1);
  }
  // Also handle if target is before the first cycle start
  while (cycleStart > targetDate) {
    cycleStart = addMonths(cycleStart, -1);
  }
  return { start: cycleStart, end: addMonths(cycleStart, 1) };
};

const CustomerMonthlyReport = ({ onBack }: Props) => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const { currentStreak, bestStreak } = useStreak(user?.id);
  const [cycleOffset, setCycleOffset] = useState(0); // 0 = current cycle, -1 = previous, etc.
  const [bookings, setBookings] = useState<any[]>([]);
  const [measurements, setMeasurements] = useState<any[]>([]);
  const [meals, setMeals] = useState<any[]>([]);
  const [diagnoses, setDiagnoses] = useState<any[]>([]);
  const [prevDiagnoses, setPrevDiagnoses] = useState<any[]>([]);
  const [prevBookings, setPrevBookings] = useState<any[]>([]);
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [prevWorkouts, setPrevWorkouts] = useState<any[]>([]);
  const [trainerComment, setTrainerComment] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cycleStartDate = profile?.cycle_start_date;

  // Compute current cycle window then apply offset
  const { cycleStart, cycleEnd, prevCycleStart, prevCycleEnd, isCurrentCycle } = useMemo(() => {
    if (!cycleStartDate) {
      // Fallback to calendar month if no cycle_start_date
      const now = getJSTNow();
      const base = new Date(now.getFullYear(), now.getMonth(), 1);
      const shifted = addMonths(base, cycleOffset);
      return {
        cycleStart: shifted,
        cycleEnd: addMonths(shifted, 1),
        prevCycleStart: addMonths(shifted, -1),
        prevCycleEnd: shifted,
        isCurrentCycle: cycleOffset === 0,
      };
    }
    const now = getJSTNow();
    const currentCycle = getCycleWindow(cycleStartDate, now);
    const shifted = {
      start: addMonths(currentCycle.start, cycleOffset),
      end: addMonths(currentCycle.end, cycleOffset),
    };
    const prev = {
      start: addMonths(shifted.start, -1),
      end: shifted.start,
    };
    return {
      cycleStart: shifted.start,
      cycleEnd: shifted.end,
      prevCycleStart: prev.start,
      prevCycleEnd: prev.end,
      isCurrentCycle: cycleOffset === 0,
    };
  }, [cycleStartDate, cycleOffset]);

  const canGoNext = cycleOffset < 0;

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      setLoading(true);
      const csStr = cycleStart.toISOString();
      const ceStr = cycleEnd.toISOString();
      const pcsStr = prevCycleStart.toISOString();
      const pceStr = prevCycleEnd.toISOString();
      // For monthly_reports, use month as the first day of the cycle
      const monthStr = format(cycleStart, "yyyy-MM-dd");

      const [bRes, mRes, mlRes, dRes, pdRes, pbRes, wRes, pwRes, tcRes] = await Promise.all([
        supabase.from("bookings").select("*").eq("user_id", user.id).gte("booking_date", csStr).lt("booking_date", ceStr).neq("status", "キャンセル済み"),
        supabase.from("user_measurements").select("*").eq("user_id", user.id).gte("measured_date", format(cycleStart, "yyyy-MM-dd")).lte("measured_date", format(cycleEnd, "yyyy-MM-dd")).order("measured_date", { ascending: true }),
        supabase.from("meals").select("*").eq("user_id", user.id).gte("created_at", csStr).lt("created_at", ceStr),
        supabase.from("skeletal_diagnoses").select("*").eq("user_id", user.id).gte("created_at", csStr).lt("created_at", ceStr).order("created_at", { ascending: true }),
        supabase.from("skeletal_diagnoses").select("*").eq("user_id", user.id).gte("created_at", pcsStr).lt("created_at", pceStr).order("created_at", { ascending: false }).limit(1),
        supabase.from("bookings").select("*").eq("user_id", user.id).gte("booking_date", pcsStr).lt("booking_date", pceStr).neq("status", "キャンセル済み"),
        supabase.from("workouts").select("*, exercises(name)").eq("user_id", user.id).gte("workout_date", format(cycleStart, "yyyy-MM-dd")).lt("workout_date", format(cycleEnd, "yyyy-MM-dd")).order("workout_date", { ascending: true }),
        supabase.from("workouts").select("*, exercises(name)").eq("user_id", user.id).gte("workout_date", format(prevCycleStart, "yyyy-MM-dd")).lt("workout_date", format(prevCycleEnd, "yyyy-MM-dd")).order("workout_date", { ascending: true }),
        supabase.from("monthly_reports" as any).select("*").eq("user_id", user.id).eq("month", monthStr).maybeSingle(),
      ]);

      setBookings(bRes.data || []);
      setMeasurements(mRes.data || []);
      setMeals(mlRes.data || []);
      setDiagnoses(dRes.data || []);
      setPrevDiagnoses(pdRes.data || []);
      setPrevBookings(pbRes.data || []);
      setWorkouts(wRes.data || []);
      setPrevWorkouts(pwRes.data || []);
      setTrainerComment((tcRes.data as any)?.trainer_comment || null);
      setLoading(false);
    };
    fetchAll();
  }, [user, cycleStart, cycleEnd]);

  const currentPlan = profile?.plan;
  const hasPlan = !!currentPlan && currentPlan !== '初回無料体験';
  const maxSessions = hasPlan ? (planMaxSessions[currentPlan] || 4) : 0;
  const nowInstant = Date.now();
  const visitedBookings = bookings.filter(b => new Date(b.booking_date).getTime() < nowInstant);
  const scheduledBookings = bookings.filter(b => new Date(b.booking_date).getTime() >= nowInstant);
  const sessionCount = visitedBookings.length;
  const prevSessionCount = prevBookings.length;
  const achieveRate = maxSessions > 0 ? Math.min(100, Math.round((sessionCount / maxSessions) * 100)) : 0;
  const sessionDiff = sessionCount - prevSessionCount;
  const cycleDays = differenceInDays(cycleEnd, cycleStart);
  const remainingDays = Math.max(0, differenceInDays(cycleEnd, getJSTNow()));
  const remainingSessions = Math.max(0, maxSessions - sessionCount);

  // Measurements
  const firstM = measurements.length > 0 ? measurements[0] : null;
  const lastM = measurements.length > 0 ? measurements[measurements.length - 1] : null;
  const weightChange = firstM && lastM && firstM.weight != null && lastM.weight != null ? (lastM.weight - firstM.weight) : null;
  const fatChange = firstM && lastM && firstM.body_fat != null && lastM.body_fat != null ? (lastM.body_fat - firstM.body_fat) : null;

  const measurementChartData = measurements.filter(m => m.weight != null).map(m => {
    const d = new Date(m.measured_date);
    return { date: `${d.getMonth() + 1}/${d.getDate()}`, weight: m.weight, bodyFat: m.body_fat };
  });

  // Meals
  const analyzedMeals = meals.filter(m => m.analyzed);
  const mealDays = new Set(meals.map(m => formatJST(m.created_at, "yyyy-MM-dd"))).size;
  const avgCalories = analyzedMeals.length > 0 ? Math.round(analyzedMeals.reduce((s, m) => s + (m.calories || 0), 0) / analyzedMeals.length) : null;
  const avgProtein = analyzedMeals.length > 0 ? Math.round(analyzedMeals.reduce((s, m) => s + (m.protein || 0), 0) / analyzedMeals.length * 10) / 10 : null;
  const avgFat = analyzedMeals.length > 0 ? Math.round(analyzedMeals.reduce((s, m) => s + (m.fat || 0), 0) / analyzedMeals.length * 10) / 10 : null;
  const avgCarbs = analyzedMeals.length > 0 ? Math.round(analyzedMeals.reduce((s, m) => s + (m.carbs || 0), 0) / analyzedMeals.length * 10) / 10 : null;

  const pfcData = avgProtein != null && avgFat != null && avgCarbs != null ? [
    { name: "タンパク質", value: avgProtein },
    { name: "脂質", value: avgFat },
    { name: "炭水化物", value: avgCarbs },
  ] : null;

  // Skeletal
  const latestDiag = diagnoses.length > 0 ? diagnoses[diagnoses.length - 1] : null;
  const prevDiag = prevDiagnoses.length > 0 ? prevDiagnoses[0] : null;

  // Training records
  type WorkoutRow = { exercise_name: string; workout_date: string; sets: { weight: number; reps: number }[] };
  const normalize = (rows: any[]): WorkoutRow[] => rows.map((w) => {
    const sets = (w.sets && Array.isArray(w.sets) && w.sets.length > 0)
      ? w.sets.map((s: any) => ({ weight: Number(s.weight) || 0, reps: Number(s.reps) || 0 }))
      : (w.weight != null ? [{ weight: Number(w.weight), reps: Number(w.reps) || 0 }] : []);
    return { exercise_name: w.exercises?.name || "不明", workout_date: w.workout_date, sets };
  }).filter(w => w.sets.length > 0);

  const trainingSummary = useMemo(() => {
    const cur = normalize(workouts);
    const prev = normalize(prevWorkouts);

    // Per-exercise: latest & prev max weight, sets×reps representative
    const exMap = new Map<string, WorkoutRow[]>();
    cur.forEach(w => {
      const arr = exMap.get(w.exercise_name) || [];
      arr.push(w);
      exMap.set(w.exercise_name, arr);
    });

    const summary = Array.from(exMap.entries()).map(([name, rows]) => {
      // sort by date asc
      rows.sort((a, b) => a.workout_date.localeCompare(b.workout_date));
      const maxWeightOf = (r: WorkoutRow) => r.sets.reduce((m, s) => Math.max(m, s.weight), 0);
      const latestRow = rows[rows.length - 1];
      const latestWeight = maxWeightOf(latestRow);

      // prev = previous record in current cycle if multiple, else last from prev cycle
      let prevWeight: number | null = null;
      let prevSetsRepsRow: WorkoutRow | null = null;
      if (rows.length > 1) {
        const prevRow = rows[rows.length - 2];
        prevWeight = maxWeightOf(prevRow);
        prevSetsRepsRow = prevRow;
      } else {
        const prevSame = prev.filter(p => p.exercise_name === name);
        if (prevSame.length > 0) {
          const prevRow = prevSame[prevSame.length - 1];
          prevWeight = maxWeightOf(prevRow);
          prevSetsRepsRow = prevRow;
        }
      }

      const setsRepsLatest = `${latestRow.sets.length}セット×${Math.max(...latestRow.sets.map(s => s.reps))}回`;
      const setsRepsPrev = prevSetsRepsRow ? `${prevSetsRepsRow.sets.length}セット×${Math.max(...prevSetsRepsRow.sets.map(s => s.reps))}回` : null;
      const totalVolumeLatest = latestRow.sets.reduce((sum, s) => sum + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);

      return {
        name,
        count: rows.length,
        latestWeight,
        prevWeight,
        diff: prevWeight != null ? Math.round((latestWeight - prevWeight) * 10) / 10 : null,
        setsRepsLatest,
        setsRepsPrev,
        totalVolumeLatest,
        history: rows.map(r => ({ date: r.workout_date, weight: maxWeightOf(r) })),
      };
    }).sort((a, b) => b.count - a.count);

    // Top 3 by record count for chart
    const top3 = summary.slice(0, 3);
    // Build chart data merged by date
    const dateSet = new Set<string>();
    top3.forEach(s => s.history.forEach(h => dateSet.add(h.date)));
    const dates = Array.from(dateSet).sort();
    const chartData = dates.map(d => {
      const jd = toJSTDate(`${d}T00:00:00+09:00`);
      const row: any = { date: `${jd.getMonth() + 1}/${jd.getDate()}` };
      top3.forEach(s => {
        const point = s.history.find(h => h.date === d);
        if (point) row[s.name] = point.weight;
      });
      return row;
    });

    return { summary, top3, chartData };
  }, [workouts, prevWorkouts]);

  const hasWorkouts = trainingSummary.summary.length > 0;
  const TRAINING_COLORS = ["hsl(174, 65%, 50%)", "hsl(174, 55%, 38%)", "hsl(190, 60%, 55%)"];

  // AI advice - cycle-aware
  const generateAdvice = () => {
    const parts: string[] = [];

    if (maxSessions > 0 && achieveRate >= 100) {
      parts.push("今回の目標回数を達成しました！素晴らしいです");
    } else if (maxSessions > 0 && isCurrentCycle && remainingSessions > 0 && remainingDays > 0) {
      const pace = remainingDays / remainingSessions;
      if (pace >= 7) {
        parts.push(`あと${remainingDays}日で${remainingSessions}回の来店が必要です。週1ペースで達成できます！`);
      } else if (pace >= 3) {
        parts.push(`あと${remainingDays}日で${remainingSessions}回の来店が必要です。ペースを上げていきましょう！`);
      } else {
        parts.push(`残り${remainingDays}日で${remainingSessions}回の来店が必要です。頑張りましょう！`);
      }
    } else if (sessionCount === 0) {
      parts.push("今回はまだ来店がありません。一緒に頑張りましょう！");
    }

    if (weightChange != null && weightChange < -0.5) {
      parts.push("体重も順調に減少しています。この調子で続けましょう！");
    } else if (weightChange != null && weightChange > 0.5) {
      parts.push("体重が少し増加していますが、筋肉量の増加の可能性もあります。");
    }

    if (mealDays > cycleDays * 0.7) {
      parts.push("食事記録もしっかりつけられていて素晴らしいです。");
    } else if (mealDays > 0 && mealDays < cycleDays * 0.3) {
      parts.push("食事記録をもう少しこまめにつけると、より効果的です。");
    }

    if (parts.length === 0) {
      parts.push("コツコツ続けることが大切です。一緒に頑張りましょう！");
    }

    return parts.join(" ");
  };

  const periodLabel = `${format(cycleStart, "M/d", { locale: ja })}〜${format(addMonths(cycleStart, 1), "M/d", { locale: ja })}`;

  if (loading) {
    return (
      <div className="px-4 py-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> 戻る
        </Button>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      </div>
    );
  }

  const hasTraining = sessionCount > 0 || scheduledBookings.length > 0;
  const hasMeasurements = measurements.length > 0;
  const hasMeals = meals.length > 0;
  const hasDiagnosis = !!latestDiag;
  const hasComment = !!trainerComment;

  return (
    <div className="px-4 py-4 space-y-5 slide-up">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-lg font-bold flex-1 text-center">今回のレポート</h1>
        <div className="w-8" />
      </div>

      {/* Cycle selector */}
      <div className="flex items-center justify-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setCycleOffset(o => o - 1)}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold">{periodLabel}</span>
          {isCurrentCycle && (
            <Badge variant="secondary" className="text-xs">今回</Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setCycleOffset(o => o + 1)} disabled={!canGoNext}>
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* ① Training Summary */}
      {hasTraining && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5" />
            トレーニングサマリー
          </h2>
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">来店済み</span>
                <span className="text-2xl font-extrabold">
                  {sessionCount}
                  {maxSessions > 0 && <span className="text-sm font-normal text-muted-foreground">/{maxSessions}回</span>}
                </span>
              </div>
              {maxSessions > 0 && (
                <>
                  <Progress value={achieveRate} className="h-2.5" />
                  <p className="text-sm font-bold text-center">
                    {achieveRate >= 100 ? "達成！" : `あと${remainingSessions}回！`}
                  </p>
                </>
              )}
              {scheduledBookings.length > 0 && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="w-3.5 h-3.5" />
                    今回の予約予定
                  </span>
                  <span className="text-sm font-bold">あと{scheduledBookings.length}回</span>
                </div>
              )}
              {sessionDiff !== 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  前回より{sessionDiff > 0 ? `+${sessionDiff}` : sessionDiff}回
                </p>
              )}
              {currentStreak > 0 && isCurrentCycle && (
                <div className="flex items-center justify-center gap-1.5 pt-1">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-bold">{currentStreak}週連続来店中！</span>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ② Weight/Body Fat */}
      {hasMeasurements && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" />
            体重・体脂肪の変化
          </h2>
          <Card>
            <CardContent className="p-4 space-y-3">
              {firstM && lastM && firstM.weight != null && lastM.weight != null && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">体重</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{firstM.weight}kg → {lastM.weight}kg</span>
                    <span className={`text-xs font-bold flex items-center gap-0.5 ${weightChange! < 0 ? 'text-success' : weightChange! > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      ({weightChange! > 0 ? '+' : ''}{weightChange!.toFixed(1)}kg
                      {weightChange! < 0 ? <TrendingDown className="w-3 h-3" /> : weightChange! > 0 ? <TrendingUp className="w-3 h-3" /> : <Minus className="w-3 h-3" />})
                    </span>
                  </div>
                </div>
              )}
              {firstM && lastM && firstM.body_fat != null && lastM.body_fat != null && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">体脂肪率</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{firstM.body_fat}% → {lastM.body_fat}%</span>
                    <span className={`text-xs font-bold flex items-center gap-0.5 ${fatChange! < 0 ? 'text-success' : fatChange! > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      ({fatChange! > 0 ? '+' : ''}{fatChange!.toFixed(1)}%
                      {fatChange! < 0 ? <TrendingDown className="w-3 h-3" /> : fatChange! > 0 ? <TrendingUp className="w-3 h-3" /> : <Minus className="w-3 h-3" />})
                    </span>
                  </div>
                </div>
              )}
              {weightChange != null && weightChange > 0 && (
                <p className="text-xs text-muted-foreground">筋肉量が増えている可能性があります</p>
              )}
              {measurementChartData.length > 1 && (
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={measurementChartData}>
                      <defs>
                        <linearGradient id="rptWeightG" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(174, 65%, 50%)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(174, 65%, 50%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(220, 6%, 55%)" axisLine={false} tickLine={false} />
                      <YAxis domain={['dataMin - 0.5', 'dataMax + 0.5']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} />
                      <Tooltip contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontSize: '11px' }} />
                      <Area type="monotone" dataKey="weight" stroke="hsl(174, 65%, 50%)" strokeWidth={2} fill="url(#rptWeightG)" isAnimationActive={false} dot={{ r: 3, fill: "hsl(174, 65%, 50%)", strokeWidth: 1, stroke: "hsl(0,0%,100%)" }} name="体重(kg)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ②.5 Training Records */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <Dumbbell className="w-3.5 h-3.5" />
          トレーニング記録
        </h2>
        {!hasWorkouts ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              トレーニング記録がまだありません
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-4">
              {/* Weight changes */}
              <div className="space-y-1.5">
                {trainingSummary.summary.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-sm">
                    <span className="font-medium flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{s.name}</span>
                      <MuscleGroupBadge exerciseName={s.name} />
                    </span>
                    <span className="text-muted-foreground">
                      {s.prevWeight != null ? (
                        <>
                          {s.prevWeight}kg → <span className="font-bold text-foreground">{s.latestWeight}kg</span>
                          {s.diff != null && s.diff !== 0 && (
                            <span className={`ml-1.5 font-bold ${s.diff > 0 ? 'text-accent' : 'text-destructive'}`}>
                              ({s.diff > 0 ? '+' : ''}{s.diff}kg{s.diff > 0 ? '↑' : '↓'})
                            </span>
                          )}
                          {s.diff === 0 && <span className="ml-1.5 text-muted-foreground">(±0)</span>}
                        </>
                      ) : (
                        <span className="font-bold text-foreground">{s.latestWeight}kg</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* Top 3 chart */}
              {trainingSummary.chartData.length > 1 && trainingSummary.top3.length > 0 && (
                <div className="pt-2 border-t border-border/60">
                  <p className="text-xs text-muted-foreground mb-2">主要種目の重量推移</p>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trainingSummary.chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(220, 6%, 55%)" axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} unit="kg" width={36} domain={['dataMin - 5', 'dataMax + 5']} />
                        <Tooltip contentStyle={{ background: 'hsl(0,0%,100%)', border: 'none', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', fontSize: '11px' }} formatter={(v: number) => `${v}kg`} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {trainingSummary.top3.map((s, i) => (
                          <Line key={s.name} type="monotone" dataKey={s.name} stroke={TRAINING_COLORS[i]} strokeWidth={2} isAnimationActive={false} dot={{ r: 3, fill: TRAINING_COLORS[i], strokeWidth: 1, stroke: 'hsl(0,0%,100%)' }} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Sets x reps changes */}
              <div className="pt-2 border-t border-border/60 space-y-1">
                <p className="text-xs text-muted-foreground mb-1.5">セット数 × 回数の変化</p>
                {trainingSummary.summary.map((s) => (
                  <div key={s.name} className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{s.name}</span>
                      <MuscleGroupBadge exerciseName={s.name} />
                    </span>
                    <span className="text-muted-foreground">
                      {s.setsRepsPrev ? (
                        <>{s.setsRepsPrev} → <span className="font-bold text-foreground">{s.setsRepsLatest}</span></>
                      ) : (
                        <span className="font-bold text-foreground">{s.setsRepsLatest}</span>
                      )}
                      {s.totalVolumeLatest > 0 && (
                        <span className="ml-2 text-muted-foreground/70">総ボリューム {s.totalVolumeLatest}kg</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ③ Meal Summary */}
      {hasMeals && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Utensils className="w-3.5 h-3.5" />
            食事記録サマリー
          </h2>
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">記録日数</span>
                <span className="text-base font-bold">{mealDays}/{cycleDays}日</span>
              </div>
              {avgCalories != null && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">平均カロリー</span>
                  <span className="text-base font-bold">{avgCalories}kcal</span>
                </div>
              )}
              {avgProtein != null && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">P (タンパク質)</p>
                    <p className="text-sm font-bold">{avgProtein}g</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">F (脂質)</p>
                    <p className="text-sm font-bold">{avgFat}g</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">C (炭水化物)</p>
                    <p className="text-sm font-bold">{avgCarbs}g</p>
                  </div>
                </div>
              )}
              {pfcData && (
                <div className="h-36 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pfcData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={55} innerRadius={30} strokeWidth={2} isAnimationActive={false}>
                        {pfcData.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v}g`} contentStyle={{ fontSize: '11px', borderRadius: '8px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ④ Skeletal */}
      {hasDiagnosis && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Bone className="w-3.5 h-3.5" />
            骨格診断の変化
          </h2>
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-sm">骨格タイプ: <span className="font-bold">{latestDiag.skeletal_type}</span></p>
              <p className="text-sm">信頼度: <span className="font-bold">{latestDiag.confidence}%</span></p>
              {prevDiag && latestDiag.confidence !== prevDiag.confidence && (
                <p className="text-sm text-accent font-bold">
                  スコアが{latestDiag.confidence - prevDiag.confidence > 0 ? '+' : ''}{latestDiag.confidence - prevDiag.confidence}点変化しました！
                </p>
              )}
              {latestDiag.image_url && prevDiag?.image_url && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">前回</p>
                    <img src={prevDiag.image_url} alt="前期" className="rounded-lg w-full aspect-[3/4] object-cover" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">今回</p>
                    <img src={latestDiag.image_url} alt="今回" className="rounded-lg w-full aspect-[3/4] object-cover" />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ⑤ Trainer Comment */}
      {hasComment && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" />
            トレーナーからのコメント
          </h2>
          <Card className="border-l-4 border-l-accent">
            <CardContent className="p-4">
              <p className="text-sm whitespace-pre-wrap">{trainerComment}</p>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ⑥ AI Advice */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          AIからのアドバイス
        </h2>
        <Card className="gym-gradient text-primary-foreground">
          <CardContent className="p-4">
            <p className="text-sm">{generateAdvice()}</p>
          </CardContent>
        </Card>
      </section>

      {/* Empty state */}
      {!hasTraining && !hasMeasurements && !hasMeals && !hasDiagnosis && !hasWorkouts && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            この期間のデータはまだありません。
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CustomerMonthlyReport;
