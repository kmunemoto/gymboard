import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface NextMilestoneInfo {
  totalSessions: number;
  nextSessionCount: number | null;
  milestoneName: string | null;
  remaining: number;
}

export const useNextMilestone = () => {
  const { user } = useAuth();
  const [info, setInfo] = useState<NextMilestoneInfo | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: ws }, { data: ms }, { data: claims }] = await Promise.all([
        supabase.from("workouts").select("workout_date").eq("user_id", user.id),
        (supabase.from as any)("training_milestones").select("id, session_count, milestone_name").order("session_count"),
        (supabase.from as any)("user_milestone_claims").select("milestone_id").eq("user_id", user.id),
      ]);
      if (cancelled) return;
      const dates = new Set((ws || []).map((w: any) => w.workout_date));
      const total = dates.size;
      const claimedIds = new Set((claims || []).map((c: any) => c.milestone_id));
      const next = (ms || []).find((m: any) => !claimedIds.has(m.id) && m.session_count > total);
      setInfo({
        totalSessions: total,
        nextSessionCount: next?.session_count ?? null,
        milestoneName: next?.milestone_name ?? null,
        remaining: next ? next.session_count - total : 0,
      });
    })();
    return () => { cancelled = true; };
  }, [user]);

  return info;
};