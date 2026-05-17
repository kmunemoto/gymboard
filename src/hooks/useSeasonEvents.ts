import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getJSTToday } from "@/lib/timezone";

export interface SeasonEvent {
  id: string;
  event_name: string;
  event_description: string | null;
  start_date: string;
  end_date: string;
  event_icon: string | null;
  reward_exp: number;
  reward_coins: number;
  reward_badge_key: string | null;
  badge_name: string | null;
  badge_icon: string | null;
}

export interface SeasonEventTask {
  id: string;
  event_id: string;
  task_key: string;
  task_name: string;
  task_description: string | null;
  task_icon: string | null;
  target_value: number;
  task_type: string;
  sort_order: number;
}

export interface EventProgress {
  task_id: string;
  current_value: number;
  completed: boolean;
}

export interface ActiveEventBundle {
  event: SeasonEvent;
  tasks: SeasonEventTask[];
  progress: Record<string, EventProgress>;
  completed: boolean;
}

export const useSeasonEvents = () => {
  const { user } = useAuth();
  const [bundles, setBundles] = useState<ActiveEventBundle[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    const today = getJSTToday();
    const { data: events } = await supabase
      .from("season_events")
      .select("*")
      .eq("is_active", true)
      .lte("start_date", today)
      .gte("end_date", today)
      .order("start_date", { ascending: true });
    if (!events || events.length === 0) {
      setBundles([]);
      return;
    }
    const eventIds = events.map((e: any) => e.id);
    const [{ data: tasks }, { data: prog }, { data: comp }] = await Promise.all([
      supabase.from("season_event_tasks").select("*").in("event_id", eventIds).order("sort_order"),
      supabase.from("user_event_progress").select("task_id, current_value, completed, event_id")
        .eq("user_id", user.id).in("event_id", eventIds),
      supabase.from("user_event_completion").select("event_id").eq("user_id", user.id).in("event_id", eventIds),
    ]);
    const completedSet = new Set((comp || []).map((c: any) => c.event_id));
    const progByTask = new Map<string, EventProgress>();
    (prog || []).forEach((p: any) => progByTask.set(p.task_id, p));
    const result: ActiveEventBundle[] = events.map((e: any) => ({
      event: e,
      tasks: (tasks || []).filter((t: any) => t.event_id === e.id),
      progress: Object.fromEntries(
        (tasks || []).filter((t: any) => t.event_id === e.id).map((t: any) => [
          t.id,
          progByTask.get(t.id) || { task_id: t.id, current_value: 0, completed: false },
        ]),
      ),
      completed: completedSet.has(e.id),
    }));
    setBundles(result);
  }, [user]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [user, refresh]);

  return { bundles, loading, refresh };
};

export const updateEventProgress = async (userId: string) => {
  const { data, error } = await supabase.rpc("update_event_progress", { _user_id: userId });
  if (error) throw error;
  return data as { completed_events: any[] };
};