import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface EquipItem {
  id: string;
  item_key: string;
  item_name: string;
  rarity: string;
  atk_bonus: number;
  def_bonus: number;
  hp_bonus: number;
  icon_name: string;
}

export interface CombatStats {
  level: number;
  base_hp: number;
  base_atk: number;
  base_def: number;
  total_hp: number;
  total_atk: number;
  total_def: number;
  equipped_weapon: EquipItem | null;
  equipped_shield: EquipItem | null;
  equipped_amulet: EquipItem | null;
}

export interface BossProgressRow {
  stage_id: number;
  boss_current_hp: number;
  total_damage_dealt: number;
  total_turns: number;
  defeated: boolean;
}

export interface BossMaster {
  id: number;
  stage_id: number;
  boss_name: string;
  boss_hp: number;
  boss_atk: number;
  boss_def: number;
  boss_description: string;
  boss_icon: string;
  boss_image_url?: string | null;
}

export const useCombatStats = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<CombatStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) { setStats(null); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.rpc("get_player_combat_stats", { p_user_id: user.id });
    if (data) setStats(data as unknown as CombatStats);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => {
    const h = () => fetch();
    window.addEventListener("equipment-updated", h);
    return () => window.removeEventListener("equipment-updated", h);
  }, [fetch]);

  return { stats, loading, refetch: fetch };
};

export const useBossProgress = () => {
  const { user } = useAuth();
  const [bosses, setBosses] = useState<BossMaster[]>([]);
  const [progress, setProgress] = useState<BossProgressRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const { data: av } = await (supabase as any)
      .from("user_avatars").select("gender").eq("user_id", user.id).maybeSingle();
    const gender = av?.gender === "male" ? "male" : "female";
    const [{ data: b }, { data: p }] = await Promise.all([
      (supabase as any).from("quest_bosses").select("*").eq("gender", gender).order("stage_id"),
      (supabase as any).from("user_quest_boss_progress").select("stage_id, boss_current_hp, total_damage_dealt, total_turns, defeated").eq("user_id", user.id),
    ]);
    setBosses((b as BossMaster[]) || []);
    setProgress((p as BossProgressRow[]) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => {
    const h = () => fetch();
    window.addEventListener("quest-progress-updated", h);
    return () => window.removeEventListener("quest-progress-updated", h);
  }, [fetch]);

  return { bosses, progress, loading, refetch: fetch };
};

export const useEquipmentInventory = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from("user_equipment")
      .select("id, equipped, item:equipment_items(*)")
      .eq("user_id", user.id);
    setItems((data || []).map((r: any) => ({ ...r.item, owned_id: r.id, equipped: r.equipped })));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => {
    const h = () => fetch();
    window.addEventListener("equipment-updated", h);
    window.addEventListener("quest-progress-updated", h);
    return () => {
      window.removeEventListener("equipment-updated", h);
      window.removeEventListener("quest-progress-updated", h);
    };
  }, [fetch]);

  return { items, loading, refetch: fetch };
};