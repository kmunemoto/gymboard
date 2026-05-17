import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface EmoteItem {
  item_key: string;
  name: string;
  price: number;
  rarity: string;
  sort_order: number;
}

export const useEmotes = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<EmoteItem[]>([]);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const [{ data: itemsData }, { data: ownedData }] = await Promise.all([
      (supabase as any).from("avatar_customization_items").select("item_key, name, price, rarity, sort_order").eq("category", "emote").order("sort_order", { ascending: true }),
      (supabase as any).from("user_customization_items").select("item_key").eq("user_id", user.id),
    ]);
    setItems((itemsData as EmoteItem[]) || []);
    setOwned(new Set(((ownedData as any[]) || []).map((r) => r.item_key)));
    setLoading(false);
  }, [user]);

  useEffect(() => { refetch(); }, [refetch]);

  const purchase = useCallback(async (itemKey: string) => {
    const { data, error } = await (supabase as any).rpc("purchase_customization_item", { p_item_key: itemKey });
    if (error) throw error;
    await refetch();
    return data as { already_owned: boolean; equipped: boolean; remaining_coins?: number };
  }, [refetch]);

  return { items, owned, loading, refetch, purchase };
};