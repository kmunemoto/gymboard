import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PlayerSkill {
  skill_key: string;
  skill_name: string;
  skill_type: "attack" | "heal" | "buff" | "debuff";
  mp_cost: number;
  power: number;
  heal_amount: number | null;
  buff_type: string | null;
  buff_multiplier: number;
  buff_turns: number;
  description: string;
  required_level: number;
  icon_name: string;
}

export interface BattleItem {
  item_key: string;
  item_name: string;
  effect_type: "heal_hp" | "heal_mp" | "revive" | "cure_poison";
  effect_amount: number;
  description: string;
  icon_name: string;
}

export interface UserCompanion {
  id: string;
  companion_key: string;
  companion_name: string;
  element: string;
  level: number;
  base_atk: number;
  base_def: number;
  base_hp: number;
  is_active: boolean;
  icon_name: string;
  image_path?: string | null;
}

export interface StoryLine {
  timing: "intro" | "boss_intro" | "boss_defeat" | string;
  speaker: string | null;
  message: string;
  sort_order: number;
}

export interface MonsterSkill {
  action: "attack" | "skill" | "defend";
  skill_name?: string;
  power?: number;
  heal?: number;
  hits?: number;
  dispel?: boolean;
  weight: number;
  message: string;
}

export const fetchPlayerSkills = async (level: number): Promise<PlayerSkill[]> => {
  const { data } = await (supabase as any)
    .from("player_skills")
    .select("*")
    .lte("required_level", level)
    .order("required_level");
  return (data as PlayerSkill[]) || [];
};

export const fetchBattleItems = async (): Promise<Record<string, BattleItem>> => {
  const { data } = await (supabase as any).from("battle_items").select("*");
  const map: Record<string, BattleItem> = {};
  (data || []).forEach((r: any) => { map[r.item_key] = r; });
  return map;
};

export const fetchUserItems = async (userId: string): Promise<Record<string, number>> => {
  await (supabase as any).rpc("ensure_starter_items", { p_user_id: userId });
  const { data } = await (supabase as any)
    .from("user_battle_items").select("item_key, quantity").eq("user_id", userId);
  const map: Record<string, number> = {};
  (data || []).forEach((r: any) => { if (r.quantity > 0) map[r.item_key] = r.quantity; });
  return map;
};

export const fetchActiveCompanion = async (userId: string): Promise<UserCompanion | null> => {
  await (supabase as any).rpc("ensure_starter_companion", { p_user_id: userId });
  const { data } = await (supabase as any)
    .from("user_companions").select("*").eq("user_id", userId).eq("is_active", true).maybeSingle();
  return (data as UserCompanion) || null;
};

export const fetchStageStory = async (stageKey: string): Promise<Record<string, StoryLine[]>> => {
  const { data } = await (supabase as any)
    .from("dungeon_story").select("*").eq("stage_key", stageKey).order("sort_order");
  const map: Record<string, StoryLine[]> = {};
  ((data as StoryLine[]) || []).forEach((r) => {
    if (!map[r.timing]) map[r.timing] = [];
    map[r.timing].push(r);
  });
  return map;
};

export const consumeItem = async (userId: string, itemKey: string) => {
  const { data } = await (supabase as any)
    .from("user_battle_items").select("quantity").eq("user_id", userId).eq("item_key", itemKey).maybeSingle();
  const q = Math.max(0, ((data as any)?.quantity ?? 0) - 1);
  await (supabase as any)
    .from("user_battle_items").update({ quantity: q }).eq("user_id", userId).eq("item_key", itemKey);
};

export const usePlayerMp = (userId?: string | null) => {
  const [mp, setMp] = useState<{ current: number; max: number }>({ current: 0, max: 0 });

  const fetch = useCallback(async () => {
    if (!userId) return;
    const { data } = await (supabase as any)
      .from("user_avatars").select("current_mp, max_mp, level").eq("user_id", userId).maybeSingle();
    if (data) {
      const lv = (data as any).level ?? 1;
      const max = (data as any).max_mp ?? (20 + lv * 5);
      const cur = Math.min((data as any).current_mp ?? max, max);
      setMp({ current: cur, max });
    }
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { mp, setMp, refetch: fetch };
};

export const persistMp = async (userId: string, current: number, max: number) => {
  await (supabase as any).from("user_avatars").update({ current_mp: current, max_mp: max }).eq("user_id", userId);
};
