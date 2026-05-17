import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface WeightJourney {
  id: string;
  user_id: string;
  start_weight: number;
  target_weight: number;
  start_date: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface WeightJourneyMilestone {
  id: string;
  user_id: string;
  journey_id: string;
  milestone_kg: number;
  milestone_type: string;
  coins_awarded: number;
  badge_key: string | null;
  achieved_at: string;
}

export function useWeightJourney(userId: string | undefined) {
  const [journey, setJourney] = useState<WeightJourney | null>(null);
  const [milestones, setMilestones] = useState<WeightJourneyMilestone[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    const { data: j } = await supabase
      .from("weight_journey" as any)
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    setJourney((j as any) ?? null);
    if (j) {
      const { data: m } = await supabase
        .from("weight_journey_milestones" as any)
        .select("*")
        .eq("journey_id", (j as any).id)
        .order("achieved_at", { ascending: true });
      setMilestones((m as any) ?? []);
    } else {
      setMilestones([]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { journey, milestones, loading, refetch: fetch };
}

export async function checkWeightMilestones(userId: string) {
  const { data, error } = await supabase.rpc("check_weight_milestones" as any, { p_user_id: userId });
  if (error) return null;
  return data as { granted: any[]; current_weight?: number; lost?: number; progress?: number };
}
