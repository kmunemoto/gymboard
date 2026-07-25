import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// キャンセル待ち（booking_waitlist）の登録・解除・自分の登録状況取得。
const slotKey = (date: string, time: string) => `${date}|${time}`;

export const useWaitlist = (dateKey: string | null) => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    if (!user || !dateKey) {
      setEntries(new Set());
      return;
    }
    const { data, error } = await supabase
      .from("booking_waitlist")
      .select("booking_date, start_time")
      .eq("user_id", user.id)
      .eq("booking_date", dateKey);
    if (error) {
      console.warn("useWaitlist fetch failed:", error.message);
      return;
    }
    setEntries(new Set((data || []).map((r) => slotKey(r.booking_date, r.start_time))));
  }, [user, dateKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isOnWaitlist = (date: string, time: string) => entries.has(slotKey(date, time));

  // 登録/解除をトグルする。成功時に true(=登録した) / false(=解除した) を返す。null は失敗。
  const toggle = async (date: string, time: string): Promise<boolean | null> => {
    if (!user) return null;
    const key = slotKey(date, time);
    if (entries.has(key)) {
      const { error } = await supabase
        .from("booking_waitlist")
        .delete()
        .eq("user_id", user.id)
        .eq("booking_date", date)
        .eq("start_time", time);
      if (error) {
        console.warn("waitlist delete failed:", error.message);
        return null;
      }
      await refresh();
      return false;
    }
    const { fetchMyTenantId } = await import("@/lib/tenantHelper");
    const tenantId = await fetchMyTenantId();
    if (!tenantId) return null;
    const { error } = await supabase
      .from("booking_waitlist")
      .insert({ tenant_id: tenantId, user_id: user.id, booking_date: date, start_time: time });
    if (error) {
      console.warn("waitlist insert failed:", error.message);
      return null;
    }
    await refresh();
    return true;
  };

  return { isOnWaitlist, toggle, refresh };
};
