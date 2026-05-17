import { supabase } from "@/integrations/supabase/client";
import { calculateLevel, ACHIEVEMENTS } from "./avatarSystem";

export interface WorkoutRow {
  id: string;
  workout_date: string;
  weight: number | null;
  reps: number | null;
  sets: { set: number; weight: number; reps: number }[] | null;
  exercise_id: string;
  exercise_name?: string;
}

const ymd = (d: string) => d.substring(0, 10);
const ym = (d: string) => d.substring(0, 7) + "-01";

const planMaxSessions: Record<string, number> = {
  "月4回": 4,
  "月6回": 6,
  "月8回": 8,
  "通い放題": 15,
};

/**
 * Insert exp logs (idempotent via UNIQUE) and recompute totals.
 * Returns { newExp, oldLevel, newLevel, oldCoins, newCoins }
 */
export async function recomputeAvatar(
  userId: string,
  newLogs: { exp_amount: number; reason: string; reference_date: string | null }[],
) {
  // Fetch current avatar
  const { data: existing } = await supabase
    .from("user_avatars")
    .select("total_exp, level, coins")
    .eq("user_id", userId)
    .maybeSingle();

  const oldExp = existing?.total_exp ?? 0;
  const oldLevel = existing?.level ?? 1;
  const oldCoins = existing?.coins ?? 0;

  // Insert new logs (ignore duplicates via onConflict)
  if (newLogs.length > 0) {
    const rows = newLogs.map((l) => ({ user_id: userId, ...l }));
    await supabase
      .from("avatar_exp_logs")
      .upsert(rows, { onConflict: "user_id,reason,reference_date", ignoreDuplicates: true });
  }

  // Re-sum from all logs to get authoritative total
  const { data: allLogs } = await supabase
    .from("avatar_exp_logs")
    .select("exp_amount")
    .eq("user_id", userId);
  const newExp = (allLogs || []).reduce((s, r: any) => s + (Number(r.exp_amount) || 0), 0);
  const newLevel = calculateLevel(newExp);
  const newCoins = oldCoins + Math.max(0, newLevel - oldLevel) * 10;
  const addedExp = newExp - oldExp;

  if (addedExp === 0 && existing && newLevel === oldLevel) {
    return { addedExp: 0, oldLevel, newLevel: oldLevel, oldCoins, newCoins: oldCoins, newExp: oldExp };
  }

  if (existing) {
    await supabase
      .from("user_avatars")
      .update({ total_exp: newExp, level: newLevel, coins: newCoins })
      .eq("user_id", userId);
  } else {
    await supabase.from("user_avatars").insert({
      user_id: userId,
      total_exp: newExp,
      level: newLevel,
      coins: newCoins,
    });
  }

  return { addedExp, oldLevel, newLevel, oldCoins, newCoins, newExp };
}

/**
 * Build EXP logs from a complete workout history.
 * Idempotent — safe to run multiple times (DB UNIQUE filters duplicates).
 */
export function buildExpLogsFromWorkouts(
  workouts: WorkoutRow[],
  plan: string | null | undefined,
): { exp_amount: number; reason: string; reference_date: string | null }[] {
  const logs: { exp_amount: number; reason: string; reference_date: string | null }[] = [];

  // Group by date
  const byDate = new Map<string, WorkoutRow[]>();
  for (const w of workouts) {
    const d = ymd(w.workout_date);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(w);
  }
  const dates = [...byDate.keys()].sort();

  // 1) session per day
  for (const d of dates) {
    logs.push({ exp_amount: 100, reason: `session|${d}`, reference_date: d });
  }

  // 2) personal best per exercise per day
  const bestSoFar = new Map<string, number>();
  // walk chronologically
  const sortedAll = [...workouts].sort((a, b) => a.workout_date.localeCompare(b.workout_date));
  const pbDoneKey = new Set<string>();
  for (const w of sortedAll) {
    const sets = w.sets || (w.weight != null ? [{ set: 1, weight: w.weight!, reps: w.reps! }] : []);
    if (sets.length === 0) continue;
    const maxW = Math.max(...sets.map((s) => Number(s.weight) || 0));
    if (maxW <= 0) continue;
    const prev = bestSoFar.get(w.exercise_id) ?? 0;
    if (maxW > prev) {
      bestSoFar.set(w.exercise_id, maxW);
      const d = ymd(w.workout_date);
      const key = `pb|${w.exercise_id}|${d}`;
      if (!pbDoneKey.has(key)) {
        pbDoneKey.add(key);
        logs.push({ exp_amount: 30, reason: key, reference_date: d });
      }
    }
  }

  // 3) new exercise (first time)
  const firstSeen = new Map<string, string>();
  for (const w of sortedAll) {
    if (!firstSeen.has(w.exercise_id)) firstSeen.set(w.exercise_id, ymd(w.workout_date));
  }
  for (const [exId, firstDate] of firstSeen) {
    logs.push({ exp_amount: 20, reason: `new_exercise|${exId}`, reference_date: firstDate });
  }

  // 4) streak bonus: 2 consecutive ISO weeks both having a session
  const weeksWithSessions = new Set<string>();
  for (const d of dates) {
    const dt = new Date(d);
    // compute year-week (simplified: yyyy-Www based on Sunday week)
    const onejan = new Date(dt.getFullYear(), 0, 1);
    const week = Math.ceil(((dt.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
    weeksWithSessions.add(`${dt.getFullYear()}-W${String(week).padStart(2, "0")}`);
  }
  const sortedWeeks = [...weeksWithSessions].sort();
  for (let i = 1; i < sortedWeeks.length; i++) {
    // detect adjacency
    const [py, pw] = sortedWeeks[i - 1].split("-W").map((x) => parseInt(x));
    const [cy, cw] = sortedWeeks[i].split("-W").map((x) => parseInt(x));
    const adjacent = (py === cy && cw === pw + 1) || (cy === py + 1 && pw >= 52 && cw === 1);
    if (adjacent) {
      // refer date: pick first date in current week (approx)
      const refDate = dates.find((d) => {
        const dt = new Date(d);
        const onejan = new Date(dt.getFullYear(), 0, 1);
        const w = Math.ceil(((dt.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
        return `${dt.getFullYear()}-W${String(w).padStart(2, "0")}` === sortedWeeks[i];
      });
      if (refDate) logs.push({ exp_amount: 50, reason: `streak_bonus|${sortedWeeks[i]}`, reference_date: refDate });
    }
  }

  // 5) monthly goal: count distinct session dates per month >= plan max
  if (plan && planMaxSessions[plan]) {
    const max = planMaxSessions[plan];
    const byMonth = new Map<string, Set<string>>();
    for (const d of dates) {
      const m = d.substring(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, new Set());
      byMonth.get(m)!.add(d);
    }
    for (const [m, ds] of byMonth) {
      if (ds.size >= max) {
        logs.push({ exp_amount: 200, reason: `monthly_goal|${m}-01`, reference_date: `${m}-01` });
      }
    }
  }

  return logs;
}

/**
 * Determine which achievements should be unlocked from full history.
 * Returns achievement keys to insert (DB UNIQUE will dedupe).
 */
export interface MissionStatsInput {
  /** Number of daily_missions rows where at least one mission was completed */
  rowsWithAnyComplete: number;
  /** Sum of completed_keys lengths across all rows */
  totalCompletedCount: number;
  /** Number of rows where all_completed = true */
  perfectDayCount: number;
  /** Whether at least one ISO week exists where every session date had all_completed = true */
  hasPerfectWeek: boolean;
}

export interface ExtraStatsInput {
  level?: number;
  maxComboReached?: number;
  combo5Count?: number;
  totalCoinsEarned?: number;
  gachaCount?: number;
  eventsCompletedCount?: number;
  raidContributionCount?: number;
  raidMvpCount?: number;
  hasProgressPhoto?: boolean;
}

export function computeAchievements(
  workouts: WorkoutRow[],
  totalSessions: number,
  bestStreakWeeks: number,
  exerciseMuscleGroup: (name: string) => string,
  missionStats?: MissionStatsInput,
  extra?: ExtraStatsInput,
): string[] {
  const keys: string[] = [];
  if (workouts.length > 0) keys.push("first_step");
  if (workouts.length > 0) keys.push("first_session");
  if (totalSessions >= 10) keys.push("regular_visitor");
  if (totalSessions >= 50) keys.push("fifty_sessions");
  if (totalSessions >= 100) keys.push("hundred_sessions");
  if (totalSessions >= 200) keys.push("two_hundred_sessions");
  if (bestStreakWeeks >= 4) keys.push("habit_formed");
  if (bestStreakWeeks >= 12) keys.push("three_months");
  if (bestStreakWeeks >= 26) keys.push("half_year");
  if (bestStreakWeeks >= 52) keys.push("one_year");

  // power_up: any PB after first time + count PBs
  const seen = new Map<string, number>();
  let powerUp = false;
  let pbCount = 0;
  for (const w of [...workouts].sort((a, b) => a.workout_date.localeCompare(b.workout_date))) {
    const sets = w.sets || (w.weight != null ? [{ set: 1, weight: w.weight!, reps: w.reps! }] : []);
    if (sets.length === 0) continue;
    const maxW = Math.max(...sets.map((s) => Number(s.weight) || 0));
    if (maxW <= 0) continue;
    const prev = seen.get(w.exercise_id);
    if (prev !== undefined && maxW > prev) {
      powerUp = true;
      pbCount += 1;
    }
    if (prev === undefined || maxW > prev) seen.set(w.exercise_id, maxW);
  }
  if (powerUp) keys.push("power_up");
  if (pbCount >= 1) keys.push("first_pb");
  if (pbCount >= 10) keys.push("best_hunter");
  if (pbCount >= 30) keys.push("record_breaker");

  // multiplayer: 5+ distinct exercises
  const exNames = new Set(workouts.map((w) => w.exercise_name || w.exercise_id));
  if (exNames.size >= 5) keys.push("multiplayer");

  // ton_club / ten_ton_club: any session date with total volume thresholds
  const volByDate = new Map<string, number>();
  for (const w of workouts) {
    const sets = w.sets || (w.weight != null ? [{ set: 1, weight: w.weight!, reps: w.reps! }] : []);
    const v = sets.reduce((s, st) => s + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0);
    volByDate.set(w.workout_date, (volByDate.get(w.workout_date) || 0) + v);
  }
  const maxDayVol = volByDate.size > 0 ? Math.max(...volByDate.values()) : 0;
  if (maxDayVol >= 1000) keys.push("ton_club");
  if (maxDayVol >= 10000) keys.push("ten_ton_club");

  // Monthly volume thresholds
  const volByMonth = new Map<string, number>();
  for (const w of workouts) {
    const m = w.workout_date.substring(0, 7);
    const sets = w.sets || (w.weight != null ? [{ set: 1, weight: w.weight!, reps: w.reps! }] : []);
    const v = sets.reduce((s, st) => s + (Number(st.weight) || 0) * (Number(st.reps) || 0), 0);
    volByMonth.set(m, (volByMonth.get(m) || 0) + v);
  }
  const maxMonthVol = volByMonth.size > 0 ? Math.max(...volByMonth.values()) : 0;
  if (maxMonthVol >= 50000) keys.push("month_50k");
  if (maxMonthVol >= 200000) keys.push("month_200k");

  // balance_master / all_rounder: any month with 5+ / 7+ distinct muscle groups
  const monthGroups = new Map<string, Set<string>>();
  for (const w of workouts) {
    const m = w.workout_date.substring(0, 7);
    if (!monthGroups.has(m)) monthGroups.set(m, new Set());
    monthGroups.get(m)!.add(exerciseMuscleGroup(w.exercise_name || ""));
  }
  const maxMonthGroups = monthGroups.size > 0 ? Math.max(...[...monthGroups.values()].map((s) => s.size)) : 0;
  if (maxMonthGroups >= 5) keys.push("balance_master");
  if (maxMonthGroups >= 7) keys.push("all_rounder");

  // Mission-related achievements
  if (missionStats) {
    if (missionStats.rowsWithAnyComplete >= 1) keys.push("mission_clear");
    if (missionStats.totalCompletedCount >= 30) keys.push("mission_master");
    if (missionStats.perfectDayCount >= 1) keys.push("perfect_day");
    if (missionStats.hasPerfectWeek) keys.push("perfect_week");
  }

  if (extra) {
    if ((extra.level || 0) >= 10) keys.push("level_10");
    if ((extra.level || 0) >= 25) keys.push("level_25");
    if ((extra.level || 0) >= 50) keys.push("level_50");
    if ((extra.maxComboReached || 0) >= 3) keys.push("combo_starter");
    if ((extra.maxComboReached || 0) >= 10) keys.push("combo_king");
    if ((extra.totalCoinsEarned || 0) >= 500) keys.push("coin_collector");
    if ((extra.gachaCount || 0) >= 30) keys.push("gacha_addict");
    if ((extra.eventsCompletedCount || 0) >= 1) keys.push("first_event");
    if ((extra.eventsCompletedCount || 0) >= 3) keys.push("event_master");
    if ((extra.raidContributionCount || 0) >= 1) keys.push("first_raid");
    if ((extra.raidMvpCount || 0) >= 1) keys.push("raid_mvp");
    if (extra.hasProgressPhoto) keys.push("first_shot");
    if ((extra.combo5Count || 0) >= 3) keys.push("combo_master_ach");
  }

  return keys;
}

export async function unlockAchievements(userId: string, keys: string[]) {
  if (keys.length === 0) return [];
  const rows = keys.map((k) => ({ user_id: userId, achievement_key: k }));
  const { data } = await supabase
    .from("avatar_achievements")
    .upsert(rows, { onConflict: "user_id,achievement_key", ignoreDuplicates: true })
    .select("achievement_key");
  return (data || []).map((r: any) => r.achievement_key as string);
}