import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface DungeonStage {
  id: string;
  stage_key: string;
  stage_name: string;
  stage_order: number;
  floor_count: number;
  unlock_condition: string | null;
  background_css: string;
  recommended_level_min?: number;
  recommended_level_max?: number;
}

export interface DungeonMonster {
  id: string;
  stage_key: string;
  monster_key: string;
  monster_name: string;
  floor_number: number;
  hp: number;
  atk: number;
  def: number;
  coin_reward: number;
  exp_reward: number;
  drop_material_key: string | null;
  drop_material_rate: number;
  drop_ticket_rate: number;
  icon_name: string;
  is_boss: boolean;
  monster_level: number;
  monster_count: number;
}

export interface StaminaInfo {
  current_stamina: number;
  max_stamina: number;
  bonus_stamina: number;
  next_recovery_at: string;
}

export const useDungeonStages = () => {
  const { user } = useAuth();
  const [stages, setStages] = useState<DungeonStage[]>([]);
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data: s } = await (supabase as any)
      .from("dungeon_stages").select("*").order("stage_order");
    setStages((s as DungeonStage[]) || []);
    if (user) {
      const { data: r } = await (supabase as any)
        .from("dungeon_runs")
        .select("stage_key")
        .eq("user_id", user.id)
        .eq("result", "victory");
      setClearedKeys(new Set((r || []).map((x: any) => x.stage_key)));
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);
  return { stages, clearedKeys, loading, refetch: fetch };
};

export const useStamina = () => {
  const { user } = useAuth();
  const [stamina, setStamina] = useState<StaminaInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) { setStamina(null); setLoading(false); return; }
    setLoading(true);
    const { data } = await (supabase as any).rpc("recover_stamina", { p_user_id: user.id });
    if (data) setStamina(data as StaminaInfo);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => {
    const h = () => fetch();
    window.addEventListener("stamina-updated", h);
    return () => window.removeEventListener("stamina-updated", h);
  }, [fetch]);

  return { stamina, loading, refetch: fetch };
};

export const fetchDungeonMonsters = async (stageKey: string): Promise<DungeonMonster[]> => {
  const { data } = await (supabase as any)
    .from("dungeon_monsters")
    .select("*")
    .eq("stage_key", stageKey)
    .order("floor_number");
  return (data as DungeonMonster[]) || [];
};

export const startDungeonRun = async (userId: string, stageKey: string) => {
  const { data, error } = await (supabase as any).rpc("start_dungeon_run", {
    p_user_id: userId,
    p_stage_key: stageKey,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { run_id: string; stage_key: string; stage_name: string; floor_count: number; stamina_remaining: number };
};

export const completeDungeonRun = async (
  runId: string,
  floorsCleared: number,
  totalExp: number,
  totalCoins: number,
  result: "victory" | "defeat" | "retreat",
  droppedMaterials: { key: string; qty: number }[],
) => {
  const { data, error } = await (supabase as any).rpc("complete_dungeon_run", {
    p_run_id: runId,
    p_floors_cleared: floorsCleared,
    p_total_exp: totalExp,
    p_total_coins: totalCoins,
    p_result: result,
    p_dropped_materials: droppedMaterials,
  });
  if (error) throw error;
  return data;
};