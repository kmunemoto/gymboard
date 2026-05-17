import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface RaidRewardItem {
  id: string;
  raid_boss_id: string | null;
  item_key: string;
  category: "weapon" | "background" | "title" | "badge";
  name: string;
  description: string | null;
  image_url: string | null;
  required_rank: "participant" | "contributor" | "mvp";
  theme_color: string | null;
}

export interface UserRaidReward {
  id: string;
  user_id: string;
  item_key: string;
  raid_boss_id: string | null;
  earned_rank: "participant" | "contributor" | "mvp";
  earned_at: string;
}

export interface RaidParticipationStat {
  raid_id: string;
  boss_name: string;
  start_date: string;
  end_date: string;
  defeated: boolean;
  boss_image_url: string | null;
  theme_color: string | null;
  my_damage: number;
  my_rank: "participant" | "contributor" | "mvp" | "none";
  earned_items: string[];
}

export const useRaidRewards = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<RaidRewardItem[]>([]);
  const [owned, setOwned] = useState<UserRaidReward[]>([]);
  const [participation, setParticipation] = useState<RaidParticipationStat[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [itemRes, ownedRes, raidRes, dmgRes] = await Promise.all([
      (supabase as any).from("raid_reward_items").select("*"),
      (supabase as any).from("user_raid_rewards").select("*").eq("user_id", user.id),
      supabase.from("raid_bosses").select("id,boss_name,start_date,end_date,defeated,boss_image_url,theme_color"),
      supabase.from("raid_damage_logs").select("raid_id,user_id,damage"),
    ]);
    const allItems: RaidRewardItem[] = (itemRes.data as any[]) || [];
    const ownedRows: UserRaidReward[] = (ownedRes.data as any[]) || [];
    const allRaids: any[] = (raidRes.data as any[]) || [];
    const allDmg: any[] = (dmgRes.data as any[]) || [];

    setItems(allItems);
    setOwned(ownedRows);

    // compute participation stats
    const byRaid = new Map<string, Map<string, number>>();
    allDmg.forEach((d) => {
      if (!byRaid.has(d.raid_id)) byRaid.set(d.raid_id, new Map());
      const m = byRaid.get(d.raid_id)!;
      m.set(d.user_id, (m.get(d.user_id) || 0) + (d.damage || 0));
    });
    const stats: RaidParticipationStat[] = allRaids.map((r) => {
      const m = byRaid.get(r.id);
      const myDmg = m?.get(user.id) || 0;
      let rank: RaidParticipationStat["my_rank"] = "none";
      if (m && myDmg > 0) {
        const sorted = [...m.values()].sort((a, b) => b - a);
        const max = sorted[0];
        const cutoff = Math.ceil(sorted.length / 2);
        const myRankIdx = [...m.entries()].sort((a, b) => b[1] - a[1]).findIndex(([uid]) => uid === user.id);
        if (myDmg === max) rank = "mvp";
        else if (myRankIdx < cutoff) rank = "contributor";
        else rank = "participant";
      }
      const earned = ownedRows.filter((o) => o.raid_boss_id === r.id).map((o) => o.item_key);
      return {
        raid_id: r.id,
        boss_name: r.boss_name,
        start_date: r.start_date,
        end_date: r.end_date,
        defeated: r.defeated,
        boss_image_url: r.boss_image_url,
        theme_color: r.theme_color,
        my_damage: myDmg,
        my_rank: rank,
        earned_items: earned,
      };
    });
    stats.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
    setParticipation(stats);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (user) refetch();
  }, [user, refetch]);

  return { items, owned, participation, loading, refetch };
};

export { equipRaidItem, RANK_LABEL_JP } from "@/lib/raidRewards";