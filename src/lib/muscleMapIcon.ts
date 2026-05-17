import { AVATAR_CDN_BASE } from "./avatarSystem";

type MuscleKey = "chest" | "back" | "shoulder" | "legs" | "glutes" | "biceps" | "triceps" | "abs";

const KEYWORD_MAP: Array<{ keywords: string[]; muscle: MuscleKey }> = [
  { keywords: ["ベンチプレス", "チェストプレス", "ダンベルプレス", "ダンベルフライ", "ケーブルフライ", "インクライン"], muscle: "chest" },
  { keywords: ["ラットプルダウン", "シーテッドロー", "デッドリフト", "ベントオーバー", "チンニング", "懸垂", "ワンハンドロー"], muscle: "back" },
  { keywords: ["ショルダープレス", "サイドレイズ", "フロントレイズ", "リアレイズ", "アーノルドプレス"], muscle: "shoulder" },
  { keywords: ["ヒップスラスト", "ヒップアブダクション"], muscle: "glutes" },
  { keywords: ["スクワット", "スミス", "レッグプレス", "レッグエクステンション", "レッグカール", "ブルガリアン", "ランジ", "ワイドスクワット"], muscle: "legs" },
  { keywords: ["アームカール", "ハンマーカール", "ケーブルカール"], muscle: "biceps" },
  { keywords: ["トライセプス", "キックバック"], muscle: "triceps" },
  { keywords: ["クランチ", "レッグレイズ", "プランク", "アブローラー"], muscle: "abs" },
];

const GROUP_MAP: Record<string, MuscleKey> = {
  "胸": "chest",
  "背中": "back",
  "肩": "shoulder",
  "脚": "legs",
  "臀部": "glutes",
  "腕": "biceps",
  "二頭筋": "biceps",
  "上腕二頭筋": "biceps",
  "三頭筋": "triceps",
  "上腕三頭筋": "triceps",
  "腹筋": "abs",
  "体幹・腹筋": "abs",
  "脚・臀部": "legs",
};

export function getMuscleKey(exerciseName: string, muscleGroup?: string | null): MuscleKey | null {
  for (const { keywords, muscle } of KEYWORD_MAP) {
    if (keywords.some((kw) => exerciseName.includes(kw))) return muscle;
  }
  if (muscleGroup && GROUP_MAP[muscleGroup]) return GROUP_MAP[muscleGroup];
  return null;
}

export function getMuscleIconUrl(
  exerciseName: string,
  gender: "male" | "female",
  muscleGroup?: string | null
): string | null {
  const key = getMuscleKey(exerciseName, muscleGroup);
  if (!key) return null;
  return `${AVATAR_CDN_BASE}/muscle-icons/${key}_${gender}.png`;
}
