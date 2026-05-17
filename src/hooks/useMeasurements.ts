import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Measurement {
  id: string;
  user_id: string;
  measured_date: string;
  weight: number | null;
  body_fat: number | null;
}

export function useMeasurements(userId: string | undefined) {
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMeasurements = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("user_measurements")
      .select("*")
      .eq("user_id", userId)
      .order("measured_date", { ascending: true });
    if (data) setMeasurements(data as Measurement[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchMeasurements();
  }, [fetchMeasurements]);

  const saveMeasurement = useCallback(
    async (date: string, weight: number | null, bodyFat: number | null) => {
      if (!userId) return false;
      if (weight == null && bodyFat == null) {
        toast.error("体重または体脂肪率を入力してください");
        return false;
      }

      const existing = measurements.find(
        (m) => m.measured_date === date
      );

      if (existing) {
        const { error } = await supabase
          .from("user_measurements")
          .update({ weight, body_fat: bodyFat })
          .eq("id", existing.id);
        if (error) {
          toast.error("更新に失敗しました");
          return false;
        }
      } else {
        const { error } = await supabase
          .from("user_measurements")
          .insert({ user_id: userId, measured_date: date, weight, body_fat: bodyFat });
        if (error) {
          toast.error("保存に失敗しました");
          return false;
        }
      }

      await fetchMeasurements();
      toast.success("計測データを保存しました");
      // Evaluate weight journey milestones (no-op when none set)
      try {
        const { data: res } = await supabase.rpc("check_weight_milestones" as any, { p_user_id: userId });
        const granted = (res as any)?.granted as any[] | undefined;
        if (granted && granted.length > 0) {
          for (const g of granted) {
            // toast suppressed: badge unlock notifications hidden
          }
        }
      } catch {}
      return true;
    },
    [userId, measurements, fetchMeasurements]
  );

  const deleteMeasurement = useCallback(
    async (id: string) => {
      const { error } = await supabase
        .from("user_measurements")
        .delete()
        .eq("id", id);
      if (error) {
        toast.error("削除に失敗しました");
        return false;
      }
      await fetchMeasurements();
      toast.success("計測データを削除しました");
      return true;
    },
    [fetchMeasurements]
  );

  const chartData = measurements
    .filter((m) => m.weight != null || m.body_fat != null)
    .map((m) => {
      // measured_date is yyyy-MM-dd (JST calendar day)
      const d = new Date(m.measured_date + "T00:00:00+09:00");
      return {
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        weight: m.weight,
        bodyFat: m.body_fat,
      };
    });

  const latest = measurements.length > 0 ? measurements[measurements.length - 1] : null;

  return { measurements, loading, saveMeasurement, deleteMeasurement, chartData, latest, refetch: fetchMeasurements };
}
