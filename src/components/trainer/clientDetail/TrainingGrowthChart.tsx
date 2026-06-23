import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import type { WorkoutRecord } from "./types";

const TrainingGrowthChart = ({ workoutRecords, loadingRecords }: { workoutRecords: WorkoutRecord[]; loadingRecords: boolean }) => {
  const { t } = useTranslation();
  const exerciseNames = useMemo(() => {
    const names = new Set<string>();
    workoutRecords.forEach((w) => { if (w.exercise_name) names.add(w.exercise_name); });
    return Array.from(names).sort();
  }, [workoutRecords]);

  const [selectedExercise, setSelectedExercise] = useState("");

  useEffect(() => {
    if (exerciseNames.length > 0 && !selectedExercise) {
      setSelectedExercise(exerciseNames[0]);
    }
  }, [exerciseNames, selectedExercise]);

  const chartData = useMemo(() => {
    const points: { date: string; weight: number; reps: number }[] = [];
    [...workoutRecords].reverse().forEach((w) => {
      if (w.exercise_name === selectedExercise) {
        const setsData = w.sets || (w.weight != null ? [{ set: 1, weight: w.weight!, reps: w.reps! }] : []);
        if (setsData.length === 0) return;
        const best = setsData.reduce((a, b) => (b.weight > a.weight ? b : a), setsData[0]);
        if (best.weight == null || best.reps == null) return;
        const d = new Date(w.workout_date);
        points.push({ date: `${d.getMonth() + 1}/${d.getDate()}`, weight: best.weight, reps: best.reps });
      }
    });
    return points;
  }, [selectedExercise, workoutRecords]);

  if (loadingRecords) return null;
  if (workoutRecords.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5" />
        {t("clientDetail.growthChart")}
      </h2>
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <Select value={selectedExercise} onValueChange={setSelectedExercise}>
            <SelectTrigger className="w-full h-11 text-sm font-medium">
              <SelectValue placeholder={t("clientDetail.selectExercise")} />
            </SelectTrigger>
            <SelectContent>
              {exerciseNames.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {chartData.length > 1 ? (
            <div className="h-44 sm:h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} />
                  <YAxis yAxisId="w" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} unit="kg" domain={["dataMin - 5", "dataMax + 5"]} width={42} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" axisLine={false} tickLine={false} unit={t("exercise.repsUnit")} width={38} />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", fontSize: "11px" }} />
                  <Line yAxisId="w" type="monotone" dataKey="weight" stroke="hsl(174, 65%, 50%)" strokeWidth={2.5} isAnimationActive={false} dot={{ r: 4, fill: "hsl(174, 65%, 50%)", strokeWidth: 2, stroke: "hsl(var(--background))" }} activeDot={{ r: 6 }} name={t("clientDetail.weight")} />
                  <Line yAxisId="r" type="monotone" dataKey="reps" stroke="hsl(210, 40%, 58%)" strokeWidth={2} strokeDasharray="5 5" isAnimationActive={false} dot={{ r: 3, fill: "hsl(210, 40%, 58%)", strokeWidth: 2, stroke: "hsl(var(--background))" }} name={t("clientDetail.reps")} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center text-sm text-muted-foreground">
              {chartData.length === 0 ? t("clientDetail.noExerciseRecord") : t("clientDetail.needTwoPoints")}
            </div>
          )}

          {chartData.length > 0 && (
            <div className="flex justify-center gap-6 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 rounded bg-[hsl(174,65%,50%)]" />
                {t("clientDetail.weight")}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 rounded" style={{ borderTop: "2px dashed hsl(210,40%,58%)", height: 0 }} />
                {t("clientDetail.reps")}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
};

export default TrainingGrowthChart;
