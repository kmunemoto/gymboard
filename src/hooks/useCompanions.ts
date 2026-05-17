import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface CompanionDef {
  companion_key: string;
  companion_name: string;
  element: string;
  evolution_stage: number;
  evolves_from: string | null;
  evolve_level: number | null;
  base_atk: number;
  base_def: number;
  base_hp: number;
  skill_name: string;
  skill_description: string;
  skill_power: number;
  skill_type: string;
  rarity: string;
  image_path: string;
}

export interface UserCompanionRow {
  id: string;
  companion_key: string;
  companion_name: string;
  element: string;
  level: number;
  exp: number;
  base_atk: number;
  base_def: number;
  base_hp: number;
  is_active: boolean;
  icon_name: string;
  image_path: string | null;
  fed_today: boolean;
  last_fed_at: string | null;
  feed_streak: number;
}

export interface FeedResult {
  success?: boolean;
  error?: string;
  exp_gain?: number;
  new_level?: number;
  new_exp?: number;
  evolved?: boolean;
  evolution_key?: string | null;
  cost?: number;
}

export const useCompanions = () => {
  const { user } = useAuth();
  const [defs, setDefs] = useState<CompanionDef[]>([]);
  const [companions, setCompanions] = useState<UserCompanionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    await (supabase as any).rpc("ensure_starter_companion", { p_user_id: user.id });
    const [defsRes, mineRes] = await Promise.all([
      (supabase as any).from("companion_defs").select("*").order("evolution_stage").order("companion_key"),
      (supabase as any).from("user_companions").select("*").eq("user_id", user.id).order("created_at"),
    ]);
    setDefs((defsRes.data as CompanionDef[]) || []);
    setCompanions((mineRes.data as UserCompanionRow[]) || []);
  }, [user]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [user, refresh]);

  const feed = useCallback(async (companionKey: string, premium: boolean): Promise<FeedResult> => {
    if (!user) return { error: "未ログイン" };
    const { data, error } = await (supabase as any).rpc("feed_companion", {
      p_user_id: user.id, p_companion_key: companionKey, p_premium: premium,
    });
    if (error) return { error: error.message };
    await refresh();
    return (data as FeedResult) || {};
  }, [user, refresh]);

  const setActive = useCallback(async (companionKey: string) => {
    if (!user) return;
    await (supabase as any).rpc("set_active_companion", {
      p_user_id: user.id, p_companion_key: companionKey,
    });
    await refresh();
  }, [user, refresh]);

  return { defs, companions, loading, refresh, feed, setActive };
};

export const findEvolutionTarget = (
  defs: CompanionDef[],
  companionKey: string,
): CompanionDef | undefined =>
  defs.find((d) => d.evolves_from === companionKey);