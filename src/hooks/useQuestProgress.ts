import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface QuestCondition {
  condition_type: string;
  target_value: number;
  display_label: string;
  sort_order: number;
  current_value: number;
}

export interface QuestStage {
  id: number;
  stage_number: number;
  name: string;
  name_before: string;
  description: string;
  story_intro: string;
  story_complete: string;
  theme_gradient_from: string;
  theme_gradient_to: string;
  theme_dark_from: string;
  theme_dark_to: string;
  theme_icon: string;
  reward_coins: number;
  reward_exp: number;
  reward_title: string | null;
  reward_badge_key: string | null;
  reward_frame: boolean;
  background_image_url?: string | null;
  conditions: QuestCondition[];
}

export interface QuestProgress {
  current_stage: number;
  stages: QuestStage[];
  completed_stage_ids: number[];
}

export const useQuestProgress = () => {
  const { user } = useAuth();
  const [data, setData] = useState<QuestProgress | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) { setData(null); setLoading(false); return; }
    setLoading(true);
    const { data: res } = await supabase.rpc("get_quest_progress", { p_user_id: user.id });
    if (res) setData(res as unknown as QuestProgress);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  useEffect(() => {
    const handler = () => fetch();
    window.addEventListener("quest-progress-updated", handler);
    return () => window.removeEventListener("quest-progress-updated", handler);
  }, [fetch]);

  return { data, loading, refetch: fetch };
};

export const isStageComplete = (stage: QuestStage): boolean =>
  stage.conditions.every((c) => Number(c.current_value) >= Number(c.target_value));