import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile } from "./useProfile";
import {
  buildExpLogsFromWorkouts,
  computeAchievements,
  recomputeAvatar,
  unlockAchievements,
  type WorkoutRow,
} from "@/lib/avatarRewards";
import { getMuscleGroup } from "@/lib/muscleGroup";
import { computeTitles } from "@/lib/titleSystem";
import { formatJST } from "@/lib/timezone";
import { toast } from "sonner";
import i18n from "@/lib/i18n";

export interface AvatarRow {
  total_exp: number;
  level: number;
  coins: number;
  combo_count?: number;
  last_session_date?: string | null;
  max_combo_reached?: number;
  combo_5_count?: number;
  equipped_title?: string | null;
  gender?: "male" | "female";
  hair_color?: string;
  equipped_weapon?: string | null;
  equipped_background?: string | null;
  equipped_emote?: string | null;
  featured_badges?: string[];
}

export interface ExpLogRow {
  id: string;
  exp_amount: number;
  reason: string;
  reference_date: string | null;
  created_at: string;
}

export const useAvatar = (autoSync = true) => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [avatar, setAvatar] = useState<AvatarRow | null>(null);
  const [logs, setLogs] = useState<ExpLogRow[]>([]);
  const [achievements, setAchievements] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelUp, setLevelUp] = useState<{ newLevel: number; earnedCoins: number } | null>(null);
  const [newAchievement, setNewAchievement] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!user) return;
    const [avRes, logRes, achRes, titleRes] = await Promise.all([
      supabase.from("user_avatars").select("total_exp, level, coins, combo_count, last_session_date, max_combo_reached, combo_5_count, equipped_title, gender, hair_color, equipped_weapon, equipped_background, equipped_emote, featured_badges").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("avatar_exp_logs")
        .select("id, exp_amount, reason, reference_date, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("avatar_achievements").select("achievement_key").eq("user_id", user.id),
      supabase.from("user_titles").select("title_key").eq("user_id", user.id),
    ]);
    setAvatar((avRes.data as AvatarRow) ?? { total_exp: 0, level: 1, coins: 0 });
    setLogs((logRes.data as ExpLogRow[]) || []);
    setAchievements(((achRes.data as any[]) || []).map((r) => r.achievement_key));
    setTitles(((titleRes.data as any[]) || []).map((r) => r.title_key));
  }, [user]);

  // Initial sync: backfill from workouts if needed
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (!autoSync) {
      refetch().finally(() => setLoading(false));
      return;
    }
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data: avRow } = await supabase
        .from("user_avatars")
        .select("total_exp, level, coins, combo_5_count, max_combo_reached")
        .eq("user_id", user.id)
        .maybeSingle();

      // Always sync logs from workouts (idempotent)
      const { data: workoutsData } = await supabase
        .from("workouts")
        .select("id, workout_date, weight, reps, sets, exercise_id, exercises(name)")
        .eq("user_id", user.id)
        .order("workout_date", { ascending: true });

      const workouts: WorkoutRow[] = (workoutsData || []).map((w: any) => ({
        id: w.id,
        workout_date: w.workout_date,
        weight: w.weight,
        reps: w.reps,
        sets: w.sets,
        exercise_id: w.exercise_id,
        exercise_name: w.exercises?.name || "",
      }));

      if (!avRow) {
        await supabase.from("user_avatars").insert({ user_id: user.id, total_exp: 0, level: 1, coins: 0 });
      }

      const expLogs = buildExpLogsFromWorkouts(workouts, profile?.plan ?? null);
      const result = await recomputeAvatar(user.id, expLogs);
      if (result.newLevel > result.oldLevel && result.oldLevel >= 1 && avRow) {
        setLevelUp({ newLevel: result.newLevel, earnedCoins: result.newCoins - result.oldCoins });
      }

      // Achievements
      const { count } = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .neq("status", "キャンセル済み")
        .lt("booking_date", new Date().toISOString());

      // Mission stats
      const { data: missionsData } = await supabase
        .from("daily_missions")
        .select("mission_date, completed_keys, all_completed")
        .eq("user_id", user.id);
      const rows = (missionsData || []) as any[];
      const rowsWithAnyComplete = rows.filter((r) => (r.completed_keys || []).length > 0).length;
      const totalCompletedCount = rows.reduce((s, r) => s + (r.completed_keys?.length || 0), 0);
      const perfectDayCount = rows.filter((r) => r.all_completed).length;
      // perfect_week: any ISO-week where every session-date in that week has all_completed
      const perfectByDate = new Map<string, boolean>();
      rows.forEach((r) => perfectByDate.set(r.mission_date, !!r.all_completed));
      const sessionDates = new Set(workouts.map((w) => w.workout_date));
      const weekMap = new Map<string, { total: number; perfect: number }>();
      sessionDates.forEach((d) => {
        const dt = new Date(d);
        const onejan = new Date(dt.getFullYear(), 0, 1);
        const wk = Math.ceil(((dt.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
        const key = `${dt.getFullYear()}-W${String(wk).padStart(2, "0")}`;
        const cur = weekMap.get(key) || { total: 0, perfect: 0 };
        cur.total += 1;
        if (perfectByDate.get(d)) cur.perfect += 1;
        weekMap.set(key, cur);
      });
      const hasPerfectWeek = [...weekMap.values()].some((v) => v.total > 0 && v.total === v.perfect);

      // Title computation
      const { data: bookingsForTitles } = await supabase
        .from("bookings")
        .select("booking_date")
        .eq("user_id", user.id)
        .neq("status", "キャンセル済み")
        .lt("booking_date", new Date().toISOString());
      const bookingHours = (bookingsForTitles || []).map((b: any) => parseInt(formatJST(b.booking_date, "HH"), 10));

      // Raid contribution count (defeated raids the user contributed to)
      const { data: raidContribs } = await supabase
        .from("raid_damage_logs")
        .select("raid_id, damage, raid_bosses!inner(defeated)")
        .eq("user_id", user.id);
      const defeatedRaidIds = new Set<string>();
      const raidContribIds = new Set<string>();
      (raidContribs || []).forEach((r: any) => {
        raidContribIds.add(r.raid_id);
        if (r.raid_bosses?.defeated) defeatedRaidIds.add(r.raid_id);
      });

      // Raid MVP detection: for each defeated raid the user contributed to,
      // check if they were a top damage dealer.
      let raidMvpCount = 0;
      if (defeatedRaidIds.size > 0) {
        const { data: allDmg } = await supabase
          .from("raid_damage_logs")
          .select("raid_id, user_id, damage")
          .in("raid_id", [...defeatedRaidIds]);
        const totals = new Map<string, Map<string, number>>();
        (allDmg || []).forEach((r: any) => {
          if (!totals.has(r.raid_id)) totals.set(r.raid_id, new Map());
          const m = totals.get(r.raid_id)!;
          m.set(r.user_id, (m.get(r.user_id) || 0) + (r.damage || 0));
        });
        for (const [, m] of totals) {
          const max = Math.max(...m.values());
          if ((m.get(user.id) || 0) >= max) raidMvpCount += 1;
        }
      }

      // Extra stats: gacha count, events completed, coins earned, progress photo
      const [{ count: gachaCount }, { count: eventsCount }, { data: coinPurchases }, { count: photoCount }] = await Promise.all([
        supabase.from("gacha_results").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("user_event_completion").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("coin_purchases").select("coins_added").eq("user_id", user.id),
        supabase.from("progress_photos").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      ]);
      const purchasedCoins = (coinPurchases || []).reduce((s: number, r: any) => s + (r.coins_added || 0), 0);
      // PB count from workouts (mirror logic in avatarRewards)
      const seenMax = new Map<string, number>();
      let pbCountTotal = 0;
      for (const w of [...workouts].sort((a, b) => a.workout_date.localeCompare(b.workout_date))) {
        const sets = w.sets && w.sets.length ? w.sets : (w.weight != null ? [{ set: 1, weight: w.weight as number, reps: (w.reps as number) || 0 }] : []);
        if (sets.length === 0) continue;
        const maxW = Math.max(...sets.map((s: any) => Number(s.weight) || 0));
        if (maxW <= 0) continue;
        const prev = seenMax.get(w.exercise_id);
        if (prev !== undefined && maxW > prev) pbCountTotal += 1;
        if (prev === undefined || maxW > prev) seenMax.set(w.exercise_id, maxW);
      }
      // Approximate total coins earned: current + level rewards already counted; sum gacha coin rewards & raid rewards
      const { data: gachaCoinRows } = await supabase
        .from("gacha_results")
        .select("reward_type, reward_amount")
        .eq("user_id", user.id)
        .eq("reward_type", "coins");
      const gachaCoinsEarned = (gachaCoinRows || []).reduce((s: number, r: any) => s + (r.reward_amount || 0), 0);
      // Use current avatar.coins + gacha coin rewards + purchases as a proxy for total earned
      const totalCoinsEarned = (avRow?.coins ?? 0) + gachaCoinsEarned + purchasedCoins;

      const achKeys = computeAchievements(workouts, count || 0, profile?.best_streak || 0, getMuscleGroup, {
        rowsWithAnyComplete, totalCompletedCount, perfectDayCount, hasPerfectWeek,
      }, {
        level: avRow?.level || 1,
        maxComboReached: avRow?.max_combo_reached || 0,
        combo5Count: avRow?.combo_5_count || 0,
        totalCoinsEarned,
        gachaCount: gachaCount || 0,
        eventsCompletedCount: eventsCount || 0,
        raidContributionCount: raidContribIds.size,
        raidMvpCount,
        hasProgressPhoto: (photoCount || 0) > 0,
      });
      const newlyUnlocked = await unlockAchievements(user.id, achKeys);
      if (newlyUnlocked.length > 0) {
        setNewAchievement(newlyUnlocked[0]);
      }

      // Trigger collection milestone evaluation (idempotent)
      try {
        const { data: milestoneRes } = await supabase.rpc("check_collection_milestones" as any, { _user_id: user.id });
        const granted = (milestoneRes as any)?.granted as Array<{ milestone: number; coins: number; title_name: string; frame?: string | null }> | undefined;
        if (granted && granted.length > 0) {
          for (const g of granted) {
            // toast suppressed: badge unlock notifications hidden
          }
        }
      } catch (e) {
        // non-fatal
      }

      const titleKeys = computeTitles({
        workouts: workouts as any,
        bookingHours,
        bestStreakWeeks: profile?.best_streak || 0,
        raidsContributedAndDefeated: defeatedRaidIds.size,
        totalMissionCompletions: totalCompletedCount,
        combo5Reached: avRow?.combo_5_count || 0,
        exerciseMuscleGroup: getMuscleGroup,
        totalSessions: count || 0,
        gachaCount: gachaCount || 0,
        maxComboReached: avRow?.max_combo_reached || 0,
        totalPbCount: pbCountTotal,
        level: avRow?.level || 1,
      });
      if (titleKeys.length > 0) {
        const rows = titleKeys.map((k) => ({ user_id: user.id, title_key: k }));
        await supabase.from("user_titles").upsert(rows, { onConflict: "user_id,title_key", ignoreDuplicates: true });
      }

      if (!cancelled) {
        await refetch();
        setLoading(false);
      }
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [user, profile?.plan, profile?.best_streak, autoSync, refetch]);

  useEffect(() => {
    const handler = () => { refetch(); };
    window.addEventListener("avatar-updated", handler);
    return () => window.removeEventListener("avatar-updated", handler);
  }, [refetch]);

  const equipTitle = useCallback(async (titleKey: string | null) => {
    if (!user) return;
    await supabase.from("user_avatars").update({ equipped_title: titleKey } as any).eq("user_id", user.id);
    await refetch();
  }, [user, refetch]);

  const updateGender = useCallback(async (gender: "male" | "female") => {
    if (!user) return;
    await supabase.from("user_avatars").update({ gender } as any).eq("user_id", user.id);
    await refetch();
  }, [user, refetch]);

  const equipEmote = useCallback(async (emoteKey: string | null) => {
    if (!user) return;
    await supabase.from("user_avatars").update({ equipped_emote: emoteKey } as any).eq("user_id", user.id);
    await refetch();
    window.dispatchEvent(new Event("avatar-gender-updated"));
  }, [user, refetch]);

  const equipHairColor = useCallback(async (hairColor: string) => {
    if (!user) return;
    await supabase.from("user_avatars").update({ hair_color: hairColor } as any).eq("user_id", user.id);
    await refetch();
    window.dispatchEvent(new Event("avatar-gender-updated"));
  }, [user, refetch]);

  const setFeaturedBadges = useCallback(async (badges: string[]) => {
    if (!user) return;
    const trimmed = badges.slice(0, 3);
    const { error } = await supabase.rpc("set_featured_badges" as any, { p_badges: trimmed });
    if (error) {
      toast.error(i18n.t("hooks.favoriteSaveFailed"), { description: error.message });
      return;
    }
    await refetch();
  }, [user, refetch]);

  return { avatar, logs, achievements, titles, loading, refetch, levelUp, clearLevelUp: () => setLevelUp(null), equipTitle, updateGender, equipEmote, equipHairColor, setFeaturedBadges, newAchievement, clearNewAchievement: () => setNewAchievement(null) };
};