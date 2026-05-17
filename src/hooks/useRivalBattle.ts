import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface RivalBattleRow {
  id: string;
  week_start: string;
  week_end: string;
  player1_id: string;
  player2_id: string;
  player1_volume: number;
  player2_volume: number;
  winner_id: string | null;
  status: "active" | "completed";
  completed_at: string | null;
}

export interface RivalRewardRow {
  id: string;
  battle_id: string;
  user_id: string;
  result: "win" | "lose" | "draw";
  coins_earned: number;
  exp_earned: number;
  win_streak: number;
  streak_bonus_coins: number;
  claimed: boolean;
  claimed_at: string | null;
  created_at: string;
}

export interface OpponentInfo {
  user_id: string;
  display_name: string;
  level: number;
  gender: "male" | "female" | null;
  hair_color: string;
  equipped_title: string | null;
}

/** Returns ISO date string YYYY-MM-DD for the JST Monday of the week containing `now`. */
export const getJstMondayString = (now: Date = new Date()): string => {
  // Convert to JST
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const day = jst.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(jst);
  monday.setDate(jst.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const isJstMonday = (now: Date = new Date()): boolean => {
  const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  return jst.getDay() === 1;
};

export const useRivalBattle = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [entered, setEntered] = useState(false);
  const [activeBattle, setActiveBattle] = useState<RivalBattleRow | null>(null);
  const [unclaimedReward, setUnclaimedReward] = useState<{ battle: RivalBattleRow; reward: RivalRewardRow } | null>(null);
  const [opponent, setOpponent] = useState<OpponentInfo | null>(null);
  const weekStart = getJstMondayString();

  const refetch = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    // Entry check
    const { data: entryRow } = await supabase
      .from("rival_battle_entries" as any)
      .select("id, matched")
      .eq("user_id", user.id)
      .eq("week_start", weekStart)
      .maybeSingle();
    setEntered(!!entryRow);

    // Active battle (current week, status=active, where user is a player)
    const { data: activeRows } = await supabase
      .from("rival_battles" as any)
      .select("*")
      .eq("week_start", weekStart)
      .eq("status", "active")
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
      .limit(1);
    const active = (activeRows && (activeRows as any)[0]) as RivalBattleRow | undefined;
    setActiveBattle(active || null);

    // Latest unclaimed reward
    const { data: rewardRows } = await supabase
      .from("rival_battle_rewards" as any)
      .select("*")
      .eq("user_id", user.id)
      .eq("claimed", false)
      .order("created_at", { ascending: false })
      .limit(1);
    const reward = (rewardRows && (rewardRows as any)[0]) as RivalRewardRow | undefined;
    if (reward) {
      const { data: bRow } = await supabase
        .from("rival_battles" as any)
        .select("*")
        .eq("id", reward.battle_id)
        .maybeSingle();
      if (bRow) setUnclaimedReward({ battle: bRow as unknown as RivalBattleRow, reward });
    } else {
      setUnclaimedReward(null);
    }

    // Opponent info for active battle
    if (active) {
      const opId = active.player1_id === user.id ? active.player2_id : active.player1_id;
      const [{ data: prof }, { data: av }] = await Promise.all([
        supabase.from("profiles").select("display_name").eq("user_id", opId).maybeSingle(),
        supabase.from("user_avatars").select("level, gender, hair_color, equipped_title").eq("user_id", opId).maybeSingle(),
      ]);
      setOpponent({
        user_id: opId,
        display_name: prof?.display_name || "ライバル",
        level: (av as any)?.level || 1,
        gender: ((av as any)?.gender as any) || null,
        hair_color: (av as any)?.hair_color || "orange",
        equipped_title: (av as any)?.equipped_title || null,
      });
    } else {
      setOpponent(null);
    }

    setLoading(false);
  }, [user, weekStart]);

  useEffect(() => { refetch(); }, [refetch]);

  const enter = useCallback(async () => {
    const { data, error } = await supabase.rpc("enter_rival_battle" as any);
    if (error) throw error;
    await refetch();
    return data;
  }, [refetch]);

  const claim = useCallback(async (battleId: string) => {
    const { data, error } = await supabase.rpc("claim_rival_reward" as any, { p_battle_id: battleId });
    if (error) throw error;
    await refetch();
    return data;
  }, [refetch]);

  return { loading, entered, activeBattle, unclaimedReward, opponent, weekStart, enter, claim, refetch };
};

export interface RivalHistoryItem {
  battle: RivalBattleRow;
  reward: RivalRewardRow | null;
  isPlayer1: boolean;
}

export const useRivalHistory = () => {
  const { user } = useAuth();
  const [history, setHistory] = useState<RivalHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ wins: 0, losses: 0, draws: 0, currentStreak: 0 });

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      const { data: battles } = await supabase
        .from("rival_battles" as any)
        .select("*")
        .eq("status", "completed")
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
        .order("completed_at", { ascending: false })
        .limit(50);
      const list = (battles as any as RivalBattleRow[]) || [];
      const ids = list.map((b) => b.id);
      let rewardMap = new Map<string, RivalRewardRow>();
      if (ids.length > 0) {
        const { data: rewards } = await supabase
          .from("rival_battle_rewards" as any)
          .select("*")
          .eq("user_id", user.id)
          .in("battle_id", ids);
        ((rewards as any as RivalRewardRow[]) || []).forEach((r) => rewardMap.set(r.battle_id, r));
      }
      const items: RivalHistoryItem[] = list.map((b) => ({
        battle: b,
        reward: rewardMap.get(b.id) || null,
        isPlayer1: b.player1_id === user.id,
      }));
      setHistory(items);

      let wins = 0, losses = 0, draws = 0, streak = 0;
      let streakBroken = false;
      items.forEach((it) => {
        const r = it.reward?.result;
        if (r === "win") {
          wins += 1;
          if (!streakBroken) streak += 1;
        } else if (r === "lose") { losses += 1; streakBroken = true; }
        else if (r === "draw") { draws += 1; streakBroken = true; }
      });
      setStats({ wins, losses, draws, currentStreak: streak });
      setLoading(false);
    })();
  }, [user]);

  return { history, stats, loading };
};