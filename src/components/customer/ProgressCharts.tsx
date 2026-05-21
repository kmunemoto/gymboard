import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Dumbbell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMeasurements } from "@/hooks/useMeasurements";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { subMonths, subYears, format } from "date-fns";
import { getJSTNow } from "@/lib/timezone";

const PERIODS = [
  { labelKey: "charts.period1m", value: "1m" },
  { labelKey: "charts.period3m", value: "3m" },
  { labelKey: "charts.period6m", value: "6m" },
  { labelKey: "charts.period1y", value: "1y" },
  { labelKey: "charts.periodAll", value: "all" },
] as const;

type PeriodValue = (typeof PERIODS)[number]["value"];

function getPeriodStart(period: PeriodValue): Date | null {
  const now = getJSTNow();
  switch (period) {
    case "1m": return subMonths(now, 1);
    case "3m": return subMonths(now, 3);
    case "6m": return subMonths(now, 6);
    case "1y": return subYears(now, 1);
    case "all": return null;
  }
}

interface SetData { set: number; weight: number; reps: number }

// Inline SVG sparkline
const Sparkline = ({ values, width = 60, height = 24 }: { values: number[]; width?: number; height?: number }) => {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = 3;
  const innerH = height - pad * 2;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const lastX = (values.length - 1) * stepX;
  const lastY = pad + innerH - ((values[values.length - 1] - min) / range) * innerH;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="#0ABAB5"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2" fill="#0ABAB5" />
    </svg>
  );
};

const ProgressCharts = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { measurements } = useMeasurements(user?.id);
  const [period, setPeriod] = useState<PeriodValue>("3m");
  const [workouts, setWorkouts] = useState<
    { workout_date: string; weight: number | null; reps: number | null; sets: SetData[] | null; exercise_name: string }[]
  >([]);
  // Fetch workouts
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("workouts")
        .select("*, exercises(name)")
        .eq("user_id", user.id)
        .order("workout_date", { ascending: true });
      if (data) {
        setWorkouts(
          data.map((w: any) => ({
            workout_date: w.workout_date,
            weight: w.weight,
            reps: w.reps,
            sets: w.sets || (w.weight != null ? [{ set: 1, weight: w.weight, reps: w.reps }] : null),
            exercise_name: w.exercises?.name || t("common.unknown"),
          }))
        );
      }
    })();
  }, [user, t]);

  const periodStart = getPeriodStart(period);

  // ---- Weight / Body Fat ----
  const filteredMeasurements = useMemo(() => {
    return measurements.filter((m) => {
      if (!periodStart) return true;
      return new Date(m.measured_date) >= periodStart;
    });
  }, [measurements, periodStart]);

  const weightChartData = useMemo(() => {
    return filteredMeasurements
      .filter((m) => m.weight != null || m.body_fat != null)
      .map((m) => {
        const d = new Date(m.measured_date);
        return {
          date: format(d, "M/d"),
          weight: m.weight,
          bodyFat: m.body_fat,
        };
      });
  }, [filteredMeasurements]);

  const weightFirst = weightChartData.length > 0 ? weightChartData[0] : null;
  const weightLast = weightChartData.length > 0 ? weightChartData[weightChartData.length - 1] : null;
  const weightDiff =
    weightFirst?.weight != null && weightLast?.weight != null
      ? (weightLast.weight - weightFirst.weight).toFixed(1)
      : null;
  const fatDiff =
    weightFirst?.bodyFat != null && weightLast?.bodyFat != null
      ? (weightLast.bodyFat - weightFirst.bodyFat).toFixed(1)
      : null;

  // ---- Training ----
  const filteredWorkouts = useMemo(() => {
    return workouts.filter((w) => {
      if (!periodStart) return true;
      return new Date(w.workout_date) >= periodStart;
    });
  }, [workouts, periodStart]);

  // Top exercises by frequency
  const topExercises = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredWorkouts.forEach((w) => {
      counts[w.exercise_name] = (counts[w.exercise_name] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
  }, [filteredWorkouts]);

  // Exercise summaries (with per-exercise sparkline series)
  const exerciseSummaries = useMemo(() => {
    return topExercises.map((name) => {
      const exWorkouts = filteredWorkouts
        .filter((w) => w.exercise_name === name)
        .sort((a, b) => a.workout_date.localeCompare(b.workout_date));
      if (exWorkouts.length === 0) return { name, first: 0, current: 0, diff: 0, series: [] as number[] };
      const getMax = (w: (typeof exWorkouts)[0]) => {
        const setsData = w.sets || (w.weight != null ? [{ set: 1, weight: w.weight!, reps: w.reps! }] : []);
        return setsData.length > 0 ? Math.max(...setsData.map((s) => s.weight)) : 0;
      };
      const series = exWorkouts.map(getMax).filter((v) => v > 0);
      const first = series[0] ?? 0;
      const current = series[series.length - 1] ?? 0;
      return { name, first, current, diff: current - first, series };
    });
  }, [topExercises, filteredWorkouts]);

  const hasWeightData = weightChartData.length > 0;
  const hasTrainingData = topExercises.length > 0;

  if (!hasWeightData && !hasTrainingData) return null;

  return (
    <div className="space-y-4">
      {/* Period Selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
              period === p.value
                ? "bg-[#3FB6AC] text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      {/* Weight / Body Fat Section */}
      {hasWeightData && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">
            {t("charts.weightBodyFat")}
          </h2>

          {/* Summary chips */}
          {weightChartData.length >= 2 && (weightDiff || fatDiff) && (
            <div className="flex gap-3 mb-3">
              {weightDiff && (
                <div className="flex items-center gap-1">
                  {parseFloat(weightDiff) <= 0 ? (
                    <TrendingDown className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <TrendingUp className="w-3.5 h-3.5 text-destructive" />
                  )}
                  <span
                    className={`text-sm font-bold ${
                      parseFloat(weightDiff) <= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {parseFloat(weightDiff) > 0 ? "+" : ""}
                    {weightDiff}kg
                  </span>
                </div>
              )}
              {fatDiff && (
                <div className="flex items-center gap-1">
                  {parseFloat(fatDiff) <= 0 ? (
                    <TrendingDown className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <TrendingUp className="w-3.5 h-3.5 text-destructive" />
                  )}
                  <span className="text-sm font-bold" style={{ color: "#FF8C42" }}>
                    {parseFloat(fatDiff) > 0 ? "+" : ""}
                    {fatDiff}%
                  </span>
                </div>
              )}
            </div>
          )}

          {weightChartData.length >= 2 ? (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-center gap-6 mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#3FB6AC" }} />
                    <span className="text-xs font-bold" style={{ color: "#3FB6AC" }}>{t("charts.weight")}</span>
                  </div>
                  {weightChartData.some((d) => d.bodyFat != null) && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#FF8C42" }} />
                      <span className="text-xs font-bold" style={{ color: "#FF8C42" }}>{t("charts.bodyFat")}</span>
                    </div>
                  )}
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={weightChartData}>
                      <defs>
                        <linearGradient id="pgWeightGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3FB6AC" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#3FB6AC" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="pgFatGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#FF8C42" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#FF8C42" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="6 6" stroke="#e0e0e0" strokeOpacity={0.3} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: "#888" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="w"
                        tick={{ fontSize: 10, fill: "#888" }}
                        axisLine={false}
                        tickLine={false}
                        width={38}
                        unit="kg"
                        domain={["dataMin - 1", "dataMax + 1"]}
                      />
                      {weightChartData.some((d) => d.bodyFat != null) && (
                        <YAxis
                          yAxisId="f"
                          orientation="right"
                          tick={{ fontSize: 10, fill: "#888" }}
                          axisLine={false}
                          tickLine={false}
                          width={35}
                          unit="%"
                          domain={["dataMin - 1", "dataMax + 1"]}
                        />
                      )}
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "12px",
                          boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                          fontSize: "12px",
                        }}
                      />
                      <Area
                        yAxisId="w"
                        type="monotone"
                        dataKey="weight"
                        stroke="#3FB6AC"
                        strokeWidth={3}
                        fill="url(#pgWeightGrad)"
                        isAnimationActive={false}
                        dot={{ r: 4, fill: "#3FB6AC", strokeWidth: 2, stroke: "hsl(var(--background))" }}
                        name={t("charts.weightSeries") as string}
                        connectNulls
                      />
                      {weightChartData.some((d) => d.bodyFat != null) && (
                        <Area
                          yAxisId="f"
                          type="monotone"
                          dataKey="bodyFat"
                          stroke="#FF8C42"
                          strokeWidth={2}
                          fill="url(#pgFatGrad)"
                          isAnimationActive={false}
                          dot={{ r: 3, fill: "#FF8C42", strokeWidth: 2, stroke: "hsl(var(--background))" }}
                          name={t("charts.bodyFatSeries") as string}
                          connectNulls
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : weightChartData.length === 1 ? (
            <Card>
              <CardContent className="p-4 text-center text-sm text-muted-foreground">
                {weightChartData[0].weight != null && (
                  <p>{t("charts.weight")}: <span className="font-bold text-foreground">{weightChartData[0].weight}kg</span></p>
                )}
                {weightChartData[0].bodyFat != null && (
                  <p>{t("charts.bodyFat")}: <span className="font-bold text-foreground">{weightChartData[0].bodyFat}%</span></p>
                )}
                <p className="text-xs mt-1">{t("charts.minDataNote")}</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 text-center text-sm text-muted-foreground">
                {t("charts.noPeriodData")}
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* Training Weight Section */}
      {hasTrainingData && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Dumbbell className="w-3.5 h-3.5" />
            {t("charts.trainingWeight")}
          </h2>

          {exerciseSummaries.length > 0 ? (
            <Card>
              <CardContent className="p-4">
                <div>
                  {exerciseSummaries.map((s, idx) => {
                    const isUp = s.diff > 0;
                    const isDown = s.diff < 0;
                    const diffColor = isUp ? "#0ABAB5" : isDown ? "#EF4444" : "#9CA3AF";
                    const diffText = s.diff === 0
                      ? "±0"
                      : `${isUp ? "+" : ""}${s.diff}kg ${isUp ? "↑" : "↓"}`;
                    return (
                      <div
                        key={s.name}
                        className="flex items-center justify-between gap-3"
                        style={{
                          padding: "12px 0",
                          borderBottom:
                            idx < exerciseSummaries.length - 1
                              ? "1px solid rgba(0,0,0,0.06)"
                              : "none",
                        }}
                      >
                        <span
                          className="truncate min-w-0 flex-1"
                          style={{ fontSize: "14px", fontWeight: 500 }}
                        >
                          {s.name}
                        </span>
                        <div className="shrink-0">
                          <Sparkline values={s.series} />
                        </div>
                        <div className="text-right shrink-0" style={{ minWidth: 56 }}>
                          <div style={{ fontSize: "18px", fontWeight: 700, lineHeight: 1.1 }}>
                            {s.current}kg
                          </div>
                          {s.series.length >= 2 && (
                            <div
                              style={{
                                fontSize: "12px",
                                fontWeight: 600,
                                color: diffColor,
                                marginTop: 2,
                              }}
                            >
                              {diffText}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 text-center text-sm text-muted-foreground">
                {t("charts.noPeriodData")}
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
};

export default ProgressCharts;
