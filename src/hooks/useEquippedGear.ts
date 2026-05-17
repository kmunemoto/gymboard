import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface EquippedGearItem {
  item_key: string;
  item_name: string;
  item_type: "weapon" | "shield" | "amulet" | "top" | "bottom";
  rarity: "common" | "rare" | "epic" | "legendary";
  image_path: string | null;
  icon_name: string | null;
  atk_bonus?: number;
  def_bonus?: number;
  hp_bonus?: number;
}

export interface EquippedGear {
  weapon: EquippedGearItem | null;
  shield: EquippedGearItem | null;
  amulet: EquippedGearItem | null;
  top: EquippedGearItem | null;
  bottom: EquippedGearItem | null;
}

const EMPTY: EquippedGear = { weapon: null, shield: null, amulet: null, top: null, bottom: null };

// Track which userIds we've already attempted starter-equipment init this session.
const _initAttempted = new Set<string>();

export const useEquippedGear = (userId?: string | null) => {
  const [gear, setGear] = useState<EquippedGear>(EMPTY);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) {
      setGear(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    let { data } = await (supabase as any)
      .from("user_equipment")
      .select("equipped, item:equipment_items(item_key,item_name,item_type,rarity,image_path,icon_name,atk_bonus,def_bonus,hp_bonus)")
      .eq("user_id", userId)
      .eq("equipped", true);

    // Auto-grant starter equipment on first ever load if user has nothing
    if ((!data || data.length === 0) && !_initAttempted.has(userId)) {
      _initAttempted.add(userId);
      const { count } = await (supabase as any)
        .from("user_equipment")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);
      if ((count ?? 0) === 0) {
        await (supabase as any).rpc("initialize_starter_equipment_for_user", { p_user_id: userId });
        const r = await (supabase as any)
          .from("user_equipment")
          .select("equipped, item:equipment_items(item_key,item_name,item_type,rarity,image_path,icon_name,atk_bonus,def_bonus,hp_bonus)")
          .eq("user_id", userId)
          .eq("equipped", true);
        data = r.data;
      }
    }

    const next: EquippedGear = { weapon: null, shield: null, amulet: null, top: null, bottom: null };
    (data || []).forEach((row: any) => {
      const it = row.item;
      if (!it) return;
      if (it.item_type === "weapon") next.weapon = it;
      else if (it.item_type === "shield") next.shield = it;
      else if (it.item_type === "amulet" || it.item_type === "accessory") next.amulet = it;
      else if (it.item_type === "top") next.top = it;
      else if (it.item_type === "bottom") next.bottom = it;
    });
    setGear(next);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => {
    const h = () => fetch();
    window.addEventListener("equipment-updated", h);
    return () => window.removeEventListener("equipment-updated", h);
  }, [fetch]);

  return { gear, loading, refetch: fetch };
};
