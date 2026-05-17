import { supabase } from "@/integrations/supabase/client";

/**
 * Map exercise name to a muscle group (Japanese label).
 * Unknown exercises return "その他".
 * Seeded with built-in fallbacks; refreshed from `exercises` table at runtime.
 */
export const muscleGroupMap: Record<string, string> = {
  // 胸
  "ベンチプレス": "胸",
  "インクラインベンチプレス": "胸",
  "インクラインダンベルプレス": "胸",
  "ダンベルフライ": "胸",
  "ダンベルプレス": "胸",
  "チェストプレス": "胸",
  "ケーブルフライ": "胸",
  // 背中
  "ラットプルダウン": "背中",
  "シーテッドロー": "背中",
  "デッドリフト": "背中",
  "ベントオーバーロー": "背中",
  "チンニング": "背中",
  "ワンハンドロー": "背中",
  "懸垂": "背中",
  // 肩
  "ショルダープレス": "肩",
  "サイドレイズ": "肩",
  "フロントレイズ": "肩",
  "リアレイズ": "肩",
  "アーノルドプレス": "肩",
  // 脚
  "スクワット": "脚",
  "スミススクワット": "脚",
  "レッグプレス": "脚",
  "レッグエクステンション": "脚",
  "レッグカール": "脚",
  "ブルガリアンスクワット": "脚",
  "ワイドスクワット": "脚",
  "ランジ": "脚",
  "ヒップスラスト": "脚",
  "ヒップアブダクション": "脚",
  // 二頭筋
  "アームカール": "二頭筋",
  "ハンマーカール": "二頭筋",
  "ケーブルカール": "二頭筋",
  // 三頭筋
  "トライセプスエクステンション": "三頭筋",
  "キックバック": "三頭筋",
  // 腹筋
  "クランチ": "腹筋",
  "レッグレイズ": "腹筋",
  "プランク": "腹筋",
  "アブローラー": "腹筋",
};

let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
let loaded = false;

export const subscribeMuscleGroup = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const isMuscleGroupLoaded = () => loaded;

/**
 * Load (or refresh) the muscle group map from the exercises table.
 * Safe to call multiple times; subsequent calls reuse the in-flight promise.
 */
export const loadMuscleGroupMap = async (force = false): Promise<void> => {
  if (loadPromise && !force) return loadPromise;
  loadPromise = (async () => {
    const { data, error } = await supabase
      .from("exercises")
      .select("name, muscle_group");
    if (error || !data) return;
    for (const row of data as Array<{ name: string; muscle_group: string | null }>) {
      if (row.name && row.muscle_group) {
        muscleGroupMap[row.name] = row.muscle_group;
      }
    }
    loaded = true;
    listeners.forEach((cb) => cb());
  })();
  try {
    await loadPromise;
  } finally {
    if (force) loadPromise = null;
  }
};

// Kick off load eagerly so most callers see DB values without awaiting.
if (typeof window !== "undefined") {
  loadMuscleGroupMap().catch(() => {});
}

export const getMuscleGroup = (exerciseName: string): string => {
  return muscleGroupMap[exerciseName] || "その他";
};

/**
 * Given a list of exercise names, return unique muscle groups joined by "・".
 * Order follows first appearance.
 */
export const summarizeMuscleGroups = (exerciseNames: string[]): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of exerciseNames) {
    const g = getMuscleGroup(n);
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out.join("・");
};