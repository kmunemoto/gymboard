import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { addMonths, format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "@/hooks/useProfile";
import { useTenant } from "@/hooks/useTenant";
import { useMyBookings } from "@/hooks/useBookings";
import { supabase } from "@/integrations/supabase/client";
import { getJSTNow } from "@/lib/timezone";
import { getMuscleGroup, loadMuscleGroupMap, subscribeMuscleGroup } from "@/lib/muscleGroup";
import {
  getTenantMuscleGroups,
  loadTenantMuscleGroups,
  subscribeTenantMuscleGroups,
} from "@/lib/tenantMuscleGroups";
import { reportPeriodAt, reportPeriodLabel, type ReportPeriodSource } from "@/lib/reportPeriod";
import { formatDate } from "@/lib/dateFormat";

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
  /**
   * 期間の材料（トレーナーのお客様詳細から、そのお客様の分を渡す。読み込み中は null）。
   * 省略時はログイン中のお客様自身の分を使う。
   */
  periodSource?: ReportPeriodSource | null;
}

/**
 * トレーニング部位バランス。
 *
 * 🔴 期間はプロフィールのカードの「利用期間」と同じ区切り（src/lib/reportPeriod.ts。2026-10-15）。
 *    以前は暦の月（1日〜月末）で、カードの利用期間とずれていた。
 *    回数券・期間プラン・起算日なしのお客様は従来どおり暦の月。
 */
const MuscleBalanceRadar = ({ userId, periodSource }: Props = {}) =>
  periodSource !== undefined
    ? <RadarCard userId={userId} periodSource={periodSource} />
    : <OwnRadarCard />;

/** お客様自身の画面: 自分のプロフィールと予約から期間を出す */
const OwnRadarCard = () => {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const { allPlans } = useTenant();
  const { bookings, loading: bookingsLoading } = useMyBookings();
  const periodSource = useMemo<ReportPeriodSource | null>(() => {
    if (profileLoading || bookingsLoading) return null;
    return {
      planName: profile?.plan,
      cycleStartDate: profile?.cycle_start_date,
      cycleStartPinned: profile?.cycle_start_pinned,
      graceEnabled: profile?.grace_enabled,
      tenantPlans: allPlans ?? [],
      bookings: bookings.map((b) => ({ booking_date: `${b.date}T${b.startTime}:00+09:00`, status: b.status })),
    };
  }, [profileLoading, bookingsLoading, profile?.plan, profile?.cycle_start_date, profile?.cycle_start_pinned, profile?.grace_enabled, allPlans, bookings]);
  return <RadarCard userId={user?.id} periodSource={periodSource} />;
};

const RadarCard = ({ userId, periodSource }: { userId?: string; periodSource: ReportPeriodSource | null }) => {
  const { t } = useTranslation();
  const [cycleOffset, setCycleOffset] = useState(0);
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  // 種目→部位マップ・部位一覧のいずれかが更新されたら +1 し、下の useMemo を再計算させる
  // (どちらも参照が変わらないモジュール単位キャッシュなので、単なる再レンダーだけでは
  // useMemo の依存配列に変化が無く再計算されないため、明示的なバージョン番号で駆動する)。
  const [groupVersion, setGroupVersion] = useState(0);

  useEffect(() => {
    loadMuscleGroupMap().catch(() => {});
    const unsub = subscribeMuscleGroup(() => setGroupVersion((n) => n + 1));
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    loadTenantMuscleGroups().catch(() => {});
    const unsub = subscribeTenantMuscleGroups(() => setGroupVersion((n) => n + 1));
    return () => { unsub(); };
  }, []);

  // ジムごとに編集可能な部位一覧（tenant_muscle_groups）。並び順はジムの設定どおり。
  const muscleGroups = useMemo(() => getTenantMuscleGroups().map((g) => g.name), [groupVersion]);

  // カードと同じ区切りの期間。対象外（回数券・期間プラン・起算日なし）は null
  const period = useMemo(
    () => (periodSource ? reportPeriodAt(periodSource, cycleOffset) : null),
    [periodSource, cycleOffset],
  );
  const { start, end } = useMemo(() => {
    if (period) return period;
    // 従来どおり暦の月（1日〜翌月1日）
    const now = getJSTNow();
    const base = new Date(now.getFullYear(), now.getMonth(), 1);
    const shifted = addMonths(base, cycleOffset);
    return { start: shifted, end: addMonths(shifted, 1) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 期間は日時の数値で見る
  }, [period?.start.getTime(), period?.end.getTime(), cycleOffset]);
  // 期間の材料が揃うまで（読み込み中）は読みに行かない
  const ready = periodSource !== null;

  useEffect(() => {
    if (!userId || !ready) return;
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
        setWorkouts(rows);
      } else {
        setWorkouts([]);
      }
    };
    fetch();
  }, [userId, ready, start, end]);

  const chartData = useMemo(() => {
    const counts: Record<string, number> = {};
    muscleGroups.forEach((g) => (counts[g] = 0));
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
    return {
      data: muscleGroups.map((g) => ({
        group: g,
        value: counts[g],
      })),
      total,
    };
  }, [workouts, muscleGroups]);

  const periodLabel = period ? reportPeriodLabel(period) : formatDate(start, "yearMonth");
  const isCurrent = cycleOffset === 0;
  const offsetLabel = period
    ? (isCurrent ? t("muscleBalance.thisPeriod") : cycleOffset === -1 ? t("muscleBalance.lastPeriod") : t("muscleBalance.periodsAgo", { count: Math.abs(cycleOffset) }))
    : (isCurrent ? t("muscleBalance.thisMonth") : cycleOffset === -1 ? t("muscleBalance.lastMonth") : t("muscleBalance.monthsAgo", { count: Math.abs(cycleOffset) }));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-accent" />
            <h3 className="font-bold text-sm">{t("muscleBalance.title")}</h3>
          </div>
          <span className="text-xs" style={{ color: "#999" }}>{periodLabel}</span>
        </div>

        <div className="flex items-center justify-between">
          <button
            onClick={() => setCycleOffset((n) => n - 1)}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition"
            aria-label={t("muscleBalance.prevPeriod")}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs text-muted-foreground">
            {offsetLabel}
          </span>
          <button
            onClick={() => setCycleOffset((n) => Math.min(0, n + 1))}
            disabled={isCurrent}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition disabled:opacity-30"
            aria-label={t("muscleBalance.nextPeriod")}
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
            {t("muscleBalance.noRecords")}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MuscleBalanceRadar;