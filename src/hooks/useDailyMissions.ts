import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getJSTToday, formatJST } from "@/lib/timezone";
import { pickDailyMissions } from "@/lib/missionSystem";
import { ensureDailyMissions, evaluateAndAwardMissions } from "@/lib/missionRewards";

export interface DailyMissionRow {
  mission_date: string;
  mission_keys: string[];
  completed_keys: string[];
  all_completed: boolean;
  exp_earned: number;
}

export const useDailyMissions = () => {
  const { user } = useAuth();
  const [mission, setMission] = useState<DailyMissionRow | null>(null);
  const [hasBookingToday, setHasBookingToday] = useState(false);
  const [hasWorkoutToday, setHasWorkoutToday] = useState(false);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) return;
    const today = getJSTToday();
    const { data } = await supabase
      .from("daily_missions")
      .select("mission_date, mission_keys, completed_keys, all_completed, exp_earned")
      .eq("user_id", user.id)
      .eq("mission_date", today)
      .maybeSingle();
    setMission(data as DailyMissionRow | null);
  }, [user]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = getJSTToday();

      // Check today's booking (non-cancelled)
      const startOfDay = `${today}T00:00:00+09:00`;
      const endOfDay = `${today}T23:59:59+09:00`;
      const [{ data: bookings }, { data: todayWorkouts }] = await Promise.all([
        supabase
          .from("bookings")
          .select("id, booking_date, status")
          .eq("user_id", user.id)
          .neq("status", "キャンセル済み")
          .gte("booking_date", startOfDay)
          .lte("booking_date", endOfDay),
        supabase
          .from("workouts")
          .select("id")
          .eq("user_id", user.id)
          .eq("workout_date", today)
          .limit(1),
      ]);
      const hasBooking = (bookings || []).some(
        (b: any) => formatJST(b.booking_date, "yyyy-MM-dd") === today,
      );
      const hasWorkout = (todayWorkouts || []).length > 0;
      if (cancelled) return;
      setHasBookingToday(hasBooking);
      setHasWorkoutToday(hasWorkout);

      if (hasBooking) {
        // Ensure mission row exists
        const { data: existing } = await supabase
          .from("daily_missions")
          .select("mission_date, mission_keys, completed_keys, all_completed, exp_earned")
          .eq("user_id", user.id)
          .eq("mission_date", today)
          .maybeSingle();
        if (existing) {
          setMission(existing as DailyMissionRow);
        } else {
          const { data: w } = await supabase
            .from("user_measurements")
            .select("weight")
            .eq("user_id", user.id)
            .not("weight", "is", null)
            .limit(1)
            .maybeSingle();
          const keys = pickDailyMissions({ hasBodyWeight: !!(w as any)?.weight });
          await ensureDailyMissions(user.id, today, keys);
          await refetch();
        }
        // Re-evaluate today's missions in case workouts already exist
        if (hasWorkout) {
          try {
            await evaluateAndAwardMissions(user.id, today);
            await refetch();
          } catch {
            /* non-fatal */
          }
        }
      }
      if (!cancelled) setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, refetch]);

  return { mission, hasBookingToday, hasWorkoutToday, loading, refetch };
};