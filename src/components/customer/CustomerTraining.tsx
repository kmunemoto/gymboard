import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dumbbell, TrendingUp, Calendar, Share2, Camera } from "lucide-react";
import {
import { DumbbellLoader } from "@/components/ui/dumbbell-loader";
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useStreak } from "@/hooks/useStreak";
import WorkoutShareModal from "./WorkoutShareModal";
import { buildSession, type RawWorkout } from "@/lib/workoutShare";
import MuscleGroupBadge from "./MuscleGroupBadge";
import { summarizeMuscleGroups, subscribeMuscleGroup, loadMuscleGroupMap } from "@/lib/muscleGroup";
import ProgressPhotosTab from "./progress/ProgressPhotosTab";
import MuscleBalanceRadar from "./MuscleBalanceRadar";
import { getMuscleIconUrl } from "@/lib/muscleMapIcon";
import { useAvatar } from "@/hooks/useAvatar";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface SetData {
  set: number;
  weight: number;
  reps: number;
}

interface WorkoutWithExercise {
  id: string;
  workout_date: string;
  weight: number | null;
  reps: number | null;
  sets: SetData[] | null;
  exercise_name: string;
  exercise_id: string;
  muscle_group: string | null;
}

const CustomerTraining = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { avatar } = useAvatar();
  const gender: "male" | "female" = avatar?.gender === "female" ? "female" : "male";
  const [subTab, setSubTab] = useState<"workout" | "photos">("workout");
  const [workouts, setWorkouts] = useState<WorkoutWithExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareDate, setShareDate] = useState<string | null>(null);
  const [totalSessions, setTotalSessions] = useState(0);
  const { currentStreak } = useStreak(user?.id);
  const [, forceMg] = useState(0);
  useEffect(() => {
    loadMuscleGroupMap().catch(() => {});
    const unsub = subscribeMuscleGroup(() => forceMg((n) => n + 1));
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from("workouts")
        .select("*, exercises(name, muscle_group)")
        .eq("user_id", user.id)
        .order("workout_date", { ascending: false })
        .limit(200);
      if (data) {
        setWorkouts(data.map((w: any) => ({
          id: w.id,
          workout_date: w.workout_date,
          weight: w.weight,
          reps: w.reps,
          sets: w.sets || (w.weight != null ? [{ set: 1, weight: w.weight, reps: w.reps }] : null),
          exercise_name: w.exercises?.name || "不明",
          exercise_id: w.exercise_id,
          muscle_group: w.exercises?.muscle_group ?? null,
        })));
      }
      setLoading(false);
    };
    fetch();
  }, [user]);

  // Fetch total sessions count (past non-cancelled bookings)
  useEffect(() => {
    if (!user) return;
    const nowIso = new Date().toISOString();
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .neq("status", "キャンセル済み")
      .lt("booking_date", nowIso)
      .then(({ count }) => setTotalSessions(count || 0));
  }, [user]);

  const exerciseNames = useMemo(() => {
    const names = new Set<string>();
    workouts.forEach((w) => names.add(w.exercise_name));
    return Array.from(names).sort();
  }, [workouts]);

  const [selectedExercise, setSelectedExercise] = useState("");

  useEffect(() => {
    if (exerciseNames.length > 0 && !selectedExercise) {
      setSelectedExercise(exerciseNames[0]);
    }
  }, [exerciseNames, selectedExercise]);

  const chartData = useMemo(() => {
    const points: { date: string; weight: number; reps: number }[] = [];
    [...workouts].reverse().forEach((w) => {
      if (w.exercise_name === selectedExercise) {
        const setsData = w.sets || (w.weight != null ? [{ set: 1, weight: w.weight!, reps: w.reps! }] : []);
        if (setsData.length === 0) return;
        // Use max weight set for graph
        const best = setsData.reduce((a, b) => (b.weight > a.weight ? b : a), setsData[0]);
        if (best.weight == null || best.reps == null) return;
        const d = new Date(w.workout_date);
        points.push({
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          weight: best.weight,
          reps: best.reps,
        });
      }
    });
    return points;
  }, [selectedExercise, workouts]);

  // Group by date for history
  const groupedByDate = useMemo(() => {
    const map: Record<string, WorkoutWithExercise[]> = {};
    workouts.forEach((w) => {
      if (!map[w.workout_date]) map[w.workout_date] = [];
      map[w.workout_date].push(w);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [workouts]);

  const rawWorkoutsForShare: RawWorkout[] = useMemo(() => workouts.map((w) => ({
    id: w.id,
    workout_date: w.workout_date,
    weight: w.weight,
    reps: w.reps,
    sets: w.sets,
    exercise_id: w.exercise_id,
    exercise_name: w.exercise_name,
  })), [workouts]);

  const shareSession = useMemo(() => {
    if (!shareDate) return null;
    return buildSession(rawWorkoutsForShare, shareDate);
  }, [shareDate, rawWorkoutsForShare]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <DumbbellLoader className="w-6 h-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="px-4 py-4 space-y-5 slide-up">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl accent-gradient flex items-center justify-center">
          <Dumbbell className="w-4.5 h-4.5 text-accent-foreground" />
        </div>
        <h1 className="text-lg font-bold">{t('training.title')}</h1>
      </div>

      {/* Sub tabs */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted">
        <button
          onClick={() => setSubTab("workout")}
          className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
            subTab === "workout" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
          }`}
        >
          <Dumbbell className="w-3.5 h-3.5" />
          {t('training.tabWorkouts')}
        </button>
        <button
          onClick={() => setSubTab("photos")}
          className={`h-9 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition ${
            subTab === "photos" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
          }`}
        >
          <Camera className="w-3.5 h-3.5" />
          {t('training.tabPhotos')}
        </button>
      </div>

      {subTab === "photos" ? (
        <ProgressPhotosTab />
      ) : (
        <>
          <MuscleBalanceRadar />
          {workouts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Dumbbell className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('training.noRecordsYet')}</p>
            <p className="text-xs mt-1">{t('training.noRecordsHelp')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Growth Chart */}
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" />
              {t('training.progressGraph')}
            </h2>
            <Card>
              <CardContent className="p-4 space-y-3">
                <Select value={selectedExercise} onValueChange={setSelectedExercise}>
                  <SelectTrigger className="w-full h-11 text-sm font-medium">
                    <SelectValue placeholder={t('training.selectExercise')} />
                  </SelectTrigger>
                  <SelectContent>
                    {exerciseNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {chartData.length > 1 ? (
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
                        <YAxis yAxisId="w" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} unit="kg" domain={["dataMin - 5", "dataMax + 5"]} width={45} />
                        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} unit={t('training.repsSuffix')} width={40} />
                        <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", fontSize: "12px" }} />
                        <Line key={`${selectedExercise}-weight`} yAxisId="w" type="monotone" dataKey="weight" stroke="hsl(174, 65%, 50%)" strokeWidth={2.5} isAnimationActive={false} dot={{ r: 5, fill: "hsl(174, 65%, 50%)", strokeWidth: 2, stroke: "hsl(var(--background))" }} activeDot={{ r: 7 }} name={t('training.weightSeries')} />
                        <Line key={`${selectedExercise}-reps`} yAxisId="r" type="monotone" dataKey="reps" stroke="hsl(210, 40%, 58%)" strokeWidth={2} strokeDasharray="5 5" isAnimationActive={false} dot={{ r: 4, fill: "hsl(210, 40%, 58%)", strokeWidth: 2, stroke: "hsl(var(--background))" }} name={t('training.repsSeries')} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                    {t('training.minDataNote')}
                  </div>
                )}

                {chartData.length > 0 && (
                  <div className="flex justify-center gap-6 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-0.5 rounded bg-[hsl(174,65%,50%)]" />
                      {t('training.weightSeries')}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-0.5 rounded bg-[hsl(210,80%,55%)] border-dashed" style={{ borderTop: "2px dashed hsl(210,80%,55%)", height: 0 }} />
                      {t('training.repsSeries')}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* History List */}
          <section>
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {t('training.history')}
            </h2>
            <div className="space-y-3">
              {groupedByDate.map(([date, records]) => {
                const d = new Date(date);
                const dayNames = ["日", "月", "火", "水", "木", "金", "土"];
                const dateStr = `${d.getMonth() + 1}月${d.getDate()}日（${dayNames[d.getDay()]}）`;

                return (
                  <Card key={date} className="card-hover">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-8 h-8 rounded-lg gym-gradient flex items-center justify-center">
                          <Dumbbell className="w-4 h-4 text-primary-foreground" />
                        </div>
                        <span className="font-bold text-sm">{dateStr}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {t('training.exerciseCount', { count: records.length })}
                        </span>
                        <button
                          onClick={() => setShareDate(date)}
                          className="w-8 h-8 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent flex items-center justify-center transition"
                          aria-label={t('training.createShareImage')}
                        >
                          <Share2 className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-xs mb-3 pl-10" style={{ color: "#999", fontSize: "12px" }}>
                        {summarizeMuscleGroups(records.map((r) => r.exercise_name))}
                      </p>
                      <div className="space-y-1.5">
                        {records.map((r) => {
                          const setsData = r.sets || (r.weight != null ? [{ set: 1, weight: r.weight!, reps: r.reps! }] : []);
                          const circleNumbers = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
                          const muscleIconUrl = getMuscleIconUrl(r.exercise_name, gender, r.muscle_group);
                          return (
                          <div key={r.id} className="text-sm py-1.5 px-3 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium truncate">{r.exercise_name}</span>
                                  <MuscleGroupBadge exerciseName={r.exercise_name} />
                                </div>
                                <div className="mt-1 space-y-0.5 pl-1">
                                  {setsData.map((s, si) => (
                                    <div key={si} className="text-xs text-muted-foreground">
                                      <span>{circleNumbers[si] || `(${si + 1})`}</span>
                                      <span className="ml-1.5">
                                        <span className="font-bold text-foreground">{s.weight}</span>kg ×{" "}
                                        <span className="font-bold text-foreground">{s.reps}</span>{t('training.repsSuffix')}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {muscleIconUrl && (
                                <img
                                  src={muscleIconUrl}
                                  alt=""
                                  loading="lazy"
                                  className="w-24 h-24 object-contain opacity-60 shrink-0 ml-3"
                                />
                              )}
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        </>
      )}
        </>
      )}

      <WorkoutShareModal
        open={!!shareDate}
        onClose={() => setShareDate(null)}
        session={shareSession}
        streakWeeks={currentStreak}
        totalSessions={totalSessions}
      />
    </div>
  );
};

export default CustomerTraining;
