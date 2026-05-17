import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getJSTToday } from "@/lib/timezone";
import type { GachaRarity } from "@/lib/gachaSystem";

export interface GachaSpinResult {
  reward_type: string;
  reward_amount: number;
  rarity: GachaRarity;
  remaining: number;
  is_duplicate?: boolean;
  // Equipment fields (when reward_type === 'equipment' or 'equipment_dup')
  equipment_key?: string;
  equipment_name?: string;
  equipment_image?: string;
  equipment_type?: "weapon" | "shield" | "amulet";
  equipment_atk?: number;
  equipment_def?: number;
  equipment_hp?: number;
}

export const useGacha = () => {
  const { user } = useAuth();
  const [ticketCount, setTicketCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { count } = await supabase
      .from("user_gacha_tickets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("used", false);
    setTicketCount(count || 0);
  }, [user]);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [user, refresh]);

  const spin = useCallback(async (): Promise<GachaSpinResult | null> => {
    if (!user) return null;
    setSpinning(true);
    try {
      const { data, error } = await supabase.rpc("spin_gacha", {
        _user_id: user.id, _result_date: getJSTToday(),
      });
      if (error) throw error;
      const r: any = data;
      if (r?.no_ticket) {
        setTicketCount(0);
        return null;
      }
      // Frame rewards have been removed from the UI; convert any frame
      // result returned by the RPC into a coin reward so it surfaces sanely.
      let rewardType = r.reward_type as string;
      let rewardAmount = r.reward_amount as number;
      if (rewardType === "frame" || rewardType === "frame_dup") {
        rewardType = "coins";
        if (!rewardAmount || rewardAmount <= 0) rewardAmount = 100;
      }
      const result: GachaSpinResult = {
        reward_type: rewardType,
        reward_amount: rewardAmount,
        rarity: r.rarity as GachaRarity,
        remaining: r.remaining ?? 0,
        is_duplicate: r.is_duplicate,
        equipment_key: r.equipment_key,
        equipment_name: r.equipment_name,
        equipment_image: r.equipment_image,
        equipment_type: r.equipment_type,
        equipment_atk: r.equipment_atk,
        equipment_def: r.equipment_def,
        equipment_hp: r.equipment_hp,
      };
      setTicketCount(result.remaining);

      // Auto-hatch companion eggs
      if (r.equipment_type === "companion_egg" && r.equipment_key) {
        await (supabase as any).rpc("hatch_companion_egg", {
          p_user_id: user.id, p_egg_key: r.equipment_key,
        });
      }

      const achKeys: string[] = ["gacha_beginner"];
      if (r.rarity === "epic" || r.rarity === "legendary") achKeys.push("gacha_lucky");
      if (r.rarity === "legendary") achKeys.push("gacha_legend");
      await supabase.from("avatar_achievements").upsert(
        achKeys.map((k) => ({ user_id: user.id, achievement_key: k })),
        { onConflict: "user_id,achievement_key", ignoreDuplicates: true } as any,
      );
      return result;
    } finally {
      setSpinning(false);
    }
  }, [user]);

  return { ticketCount, loading, spinning, spin, refresh };
};
