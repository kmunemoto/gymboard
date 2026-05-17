import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { addMonths, parseISO, format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { getJSTNow } from "@/lib/timezone";
import { getMuscleGroup, loadMuscleGroupMap, subscribeMuscleGroup } from "@/lib/muscleGroup";

const MUSCLE_GROUPS = ["胸", "背中", "肩", "脚", "二頭筋", "三頭筋", "腹筋"] as const;

const getCycleWindow = (cycleStartDate: string, targetDate: Date) => {
  let cycleStart = parseISO(cycleStartDate);
  while (addMonths(cycleStart, 1) <= targetDate) cycleStart = addMonths(cycleStart, 1);
  while (cycleStart > targetDate) cycleStart = addMonths(cycleStart, -1);
  return { start: cycleStart, end: addMonths(cycleStart, 1) };
};

interface WorkoutRow {
  workout_date: string;
  weight: number | null;
  reps: number | null;
  sets: Array<{ set: number; weight: number; reps: number }> | null;
  exercise_name: string;
  muscle_group: string | null;
}

interface Props {
  userId?: string;
  cycleStartDate?: string | null;
}

const MuscleBalanceRadar = ({ userId: userIdProp, cycleStartDate: cycleProp }: Props = {}) => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const userId = userIdProp ?? user?.id;
  const cycleStartDate = cycleProp !== undefined ? cycleProp : profile?.cycle_start_date;
  const [cycleOffset, setCycleOffset] = useState(0);
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  const [, force] = useState(0);

  useEffect(() => {
    loadMuscleGroupMap().catch(() => {});
    const unsub = subscribeMuscleGroup(() => force((n) => n + 1));
    return () => { unsub(); };
  }, []);

  // Monthly aggregation: always use calendar month windows (1st → 1st of next month).
  const { start, end } = useMemo(() => {
    const now = getJSTNow();
    const base = new Date(now.getFullYear(), now.getMonth(), 1);
    const shifted = addMonths(base, cycleOffset);
    return { start: shifted, end: addMonths(shifted, 1) };
  }, [cycleOffset]);

  useEffect(() => {
    if (!userId) return;
    const fetch = async () => {
      const startStr = format(start, "yyyy-MM-dd");
      const endStr = format(end, "yyyy-MM-dd");
      const { data } = await supabase
        .from("workouts")
        .select("workout_date, weight, reps, sets, exercises(name, muscle_group)")
        .eq("user_id", userId)
        .gte("workout_date", startStr)
        .lt("workout_date", endStr);
      if (data) {
        const rows = data.map((w: any) => ({
          workout_date: w.workout_date,
          weight: w.weight,
          reps: w.reps,
          sets: w.sets,
          exercise_name: w.exercises?.name || "不明",
          muscle_group: w.exercises?.muscle_group ?? null,
        }));
        console.log("[MuscleBalanceRadar] period", startStr, "→", endStr, "rows:", rows);
        setWorkouts(rows);
      } else {
        setWorkouts([]);
      }
    };
    fetch();
  }, [userId, start, end]);

  const chartData = useMemo(() => {
    const counts: Record<string, number> = {};
    MUSCLE_GROUPS.forEach((g) => (counts[g] = 0));
    let total = 0;
    workouts.forEach((w) => {
      // Prefer DB-joined muscle_group; fall back to hardcoded map for legacy data.
      const group = w.muscle_group || getMuscleGroup(w.exercise_name);
      if (!group || group === "その他") return;
      // Count total sets: prefer sets[] length, otherwise treat the row as 1 set.
      const setCount = Array.isArray(w.sets) && w.sets.length > 0 ? w.sets.length : 1;
      if (counts[group] !== undefined) {
        counts[group] += setCount;
        total += setCount;
      }
    });
    console.log("[MuscleBalanceRadar] counts:", counts, "total sets:", total);
    return {
      data: MUSCLE_GROUPS.map((g) => ({
        group: g,
        value: counts[g],
      })),
      total,
    };
  }, [workouts]);

  const periodLabel = format(start, "yyyy年M月");
  const isCurrent = cycleOffset === 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-accent" />
            <h3 className="font-bold text-sm">トレーニング部位バランス</h3>
          </div>
          <span className="text-xs" style={{ color: "#999" }}>{periodLabel}</span>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setCycleOffset((n) => n - 1)}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition"
            aria-label="前の期間"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-muted-foreground">
            {isCurrent ? "今月" : cycleOffset === -1 ? "先月" : `${Math.abs(cycleOffset)}ヶ月前`}
          </span>
          <button
            onClick={() => setCycleOffset((n) => Math.min(0, n + 1))}
            disabled={isCurrent}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition disabled:opacity-30"
            aria-label="次の期間"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {chartData.total > 0 ? (
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={chartData.data} outerRadius="75%">
                <PolarGrid stroke="#E5E5E5" />
                <PolarAngleAxis
                  dataKey="group"
                  tick={{ fontSize: 13, fill: "#333" }}
                />
                <Radar
                  dataKey="value"
                  stroke="#0ABAB5"
                  strokeWidth={2}
                  fill="#0ABAB5"
                  fillOpacity={0.2}
                  isAnimationActive={false}
                  dot={{ r: 3, fill: "#0ABAB5", strokeWidth: 0 }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">
            トレーニング記録がありません
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MuscleBalanceRadar;