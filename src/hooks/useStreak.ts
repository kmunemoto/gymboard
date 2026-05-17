import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { startOfWeek, isBefore, subWeeks, isAfter } from "date-fns";
import { getJSTNow, toJSTDate } from "@/lib/timezone";

interface StreakResult {
  currentStreak: number;
  bestStreak: number;
  loading: boolean;
  hasFutureBookingThisWeek: boolean;
}

/**
 * Calculate weekly visit streak (Monday-based weeks).
 * A week counts if user has ≥1 visited booking OR a future booking in the current week.
 */
export const useStreak = (userId: string | undefined): StreakResult => {
  const [currentStreak, setCurrentStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasFutureBookingThisWeek, setHasFutureBookingThisWeek] = useState(false);

  const calculate = useCallback(async () => {
    if (!userId) { setLoading(false); return; }

    // Fetch all non-cancelled bookings
    const { data: bookings } = await supabase
      .from("bookings")
      .select("booking_date")
      .eq("user_id", userId)
      .neq("status", "キャンセル済み")
      .order("booking_date", { ascending: false });

    const { data: profileData } = await supabase
      .from("profiles")
      .select("best_streak, last_streak_notified")
      .eq("user_id", userId)
      .single();

    if (!bookings || bookings.length === 0) {
      setBestStreak(profileData?.best_streak || 0);
      setCurrentStreak(0);
      setLoading(false);
      return;
    }

    const now = getJSTNow();
    const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });

    // Build a Set of week-start dates that have visited bookings (past)
    const visitedWeeks = new Set<string>();
    const futureWeeksThisWeek: string[] = [];

    for (const b of bookings) {
      const bd = toJSTDate(b.booking_date);
      const ws = startOfWeek(bd, { weekStartsOn: 1 });
      const wsKey = ws.toISOString();

      if (isBefore(bd, now)) {
        visitedWeeks.add(wsKey);
      } else {
        // Future booking in current week
        if (ws.getTime() === thisWeekStart.getTime()) {
          futureWeeksThisWeek.push(wsKey);
        }
      }
    }

    const hasThisWeekFuture = futureWeeksThisWeek.length > 0;
    setHasFutureBookingThisWeek(hasThisWeekFuture);

    // Count streak from current week backwards
    let streak = 0;
    let checkWeek = thisWeekStart;

    // Current week: count if visited OR has future booking
    const thisWeekKey = thisWeekStart.toISOString();
    if (visitedWeeks.has(thisWeekKey) || hasThisWeekFuture) {
      streak = 1;
      checkWeek = subWeeks(checkWeek, 1);

      while (true) {
        const key = checkWeek.toISOString();
        if (visitedWeeks.has(key)) {
          streak++;
          checkWeek = subWeeks(checkWeek, 1);
        } else {
          break;
        }
      }
    } else {
      // Current week has nothing — check if last week had visits
      // Streak is broken, but show "previous streak" info
      // streak stays 0
    }

    setCurrentStreak(streak);

    const dbBest = profileData?.best_streak || 0;
    const newBest = Math.max(dbBest, streak);
    setBestStreak(newBest);

    // Update best_streak in DB if needed
    if (newBest > dbBest) {
      await supabase
        .from("profiles")
        .update({ best_streak: newBest } as any)
        .eq("user_id", userId);
    }

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    calculate();
  }, [calculate]);

  return { currentStreak, bestStreak, loading, hasFutureBookingThisWeek };
};
