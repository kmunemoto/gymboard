import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface LoginBonusStatus {
  today: string;
  claimed_today: boolean;
  current_day_number: number;
  today_reward_type: "coins" | "exp" | "gacha_ticket";
  today_reward_amount: number;
  recent: { login_date: string; day_number: number }[];
}

export interface ClaimResult {
  already_claimed: boolean;
  day_number: number;
  reward_type: "coins" | "exp" | "gacha_ticket";
  reward_amount: number;
  extra_coins: number;
  streak_reset: boolean;
}

export const useLoginBonus = () => {
  const { user } = useAuth();
  const [status, setStatus] = useState<LoginBonusStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!user) { setStatus(null); setLoading(false); return; }
    const { data, error } = await (supabase.rpc as any)("get_login_bonus_status", { p_user_id: user.id });
    if (!error && data) setStatus(data as LoginBonusStatus);
    setLoading(false);
  }, [user]);

  useEffect(() => { void refetch(); }, [refetch]);

  const claim = useCallback(async (): Promise<ClaimResult | null> => {
    if (!user) return null;
    const { data, error } = await (supabase.rpc as any)("claim_daily_login_bonus", { p_user_id: user.id });
    if (error) throw error;
    await refetch();
    window.dispatchEvent(new CustomEvent("avatar-updated"));
    window.dispatchEvent(new CustomEvent("login-bonus-claimed"));
    return data as ClaimResult;
  }, [user, refetch]);

  return { status, loading, claim, refetch };
};
