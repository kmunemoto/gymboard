export type MissionKey =
  | "full_power"
  | "volume_king"
  | "three_parts"
  | "rep_master"
  | "new_record"
  | "complete_sets"
  | "morning_training"
  | "night_fighter"
  | "set_master"
  | "full_menu"
  | "endurance"
  | "heavy_lifter"
  | "balancer"
  | "double_best"
  | "high_rep"
  | "super_setter";

export interface MissionDef {
  key: MissionKey;
  name: string;
  /** Lucide icon registry name */
  icon: string;
  description: string;
  exp: number;
}

export const MISSIONS: MissionDef[] = [
  { key: "full_power", name: "フルパワー", icon: "Dumbbell", description: "全種目で前回以上の重量を挙げる", exp: 60 },
  { key: "volume_king", name: "ボリュームキング", icon: "Crown", description: "総挙上量3,000kg以上", exp: 75 },
  { key: "three_parts", name: "3部位チャレンジ", icon: "Target", description: "3つ以上の異なる部位をトレーニング", exp: 45 },
  { key: "rep_master", name: "レップマスター", icon: "Repeat", description: "全セットで10回以上", exp: 45 },
  { key: "new_record", name: "新記録ハンター", icon: "Trophy", description: "いずれかの種目で自己ベスト更新", exp: 90 },
  { key: "complete_sets", name: "コンプリートセット", icon: "CheckCircle2", description: "全種目3セット以上", exp: 45 },
  { key: "morning_training", name: "早起きトレーニング", icon: "Sunrise", description: "12:00前のセッション", exp: 30 },
  { key: "night_fighter", name: "ナイトファイター", icon: "Moon", description: "19:00以降のセッション", exp: 30 },
  { key: "set_master", name: "セットマスター", icon: "Layers", description: "合計12セット以上", exp: 45 },
  { key: "full_menu", name: "フルメニュー", icon: "ListChecks", description: "4種目以上トレーニング", exp: 45 },
  { key: "endurance", name: "エンデュランス", icon: "Activity", description: "1種目で合計30rep以上", exp: 60 },
  { key: "heavy_lifter", name: "ヘビーリフター", icon: "Weight", description: "自体重以上の重量を挙げる", exp: 75 },
  { key: "balancer", name: "バランサー", icon: "Scale", description: "上半身と下半身の両方をトレーニング", exp: 45 },
  { key: "double_best", name: "ダブルベスト", icon: "Medal", description: "2種目以上で自己ベスト更新", exp: 120 },
  { key: "high_rep", name: "ハイレップ", icon: "Zap", description: "いずれかのセットで15rep以上", exp: 30 },
  { key: "super_setter", name: "スーパーセッター", icon: "Flame", description: "合計15セット以上", exp: 60 },
];

export const MISSION_BONUS_EXP = 150;

export const getMissionDef = (key: string): MissionDef | undefined =>
  MISSIONS.find((m) => m.key === key);

/**
 * Pick 3 random missions.
 * - Avoid morning_training + night_fighter together.
 * - Avoid set_master + super_setter together (similar conditions).
 * - Skip heavy_lifter when no body weight is recorded.
 */
export const pickDailyMissions = (opts?: { hasBodyWeight?: boolean }): MissionKey[] => {
  const hasBodyWeight = opts?.hasBodyWeight !== false;
  const pool = MISSIONS.filter((m) => hasBodyWeight || m.key !== "heavy_lifter").map((m) => ({ ...m }));
  // Shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked: MissionKey[] = [];
  for (const m of pool) {
    if (picked.length >= 3) break;
    if (
      (m.key === "morning_training" && picked.includes("night_fighter")) ||
      (m.key === "night_fighter" && picked.includes("morning_training"))
    ) {
      continue;
    }
    if (
      (m.key === "set_master" && picked.includes("super_setter")) ||
      (m.key === "super_setter" && picked.includes("set_master"))
    ) {
      continue;
    }
    picked.push(m.key);
  }
  return picked;
};