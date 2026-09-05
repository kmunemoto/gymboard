/**
 * 部位アイコンの置き場（CDN）。
 *
 * 🔴 **URL を変えないこと。** ホスト名の `clsvdhovzqrkojvkvekw` は
 * **ジムボードとは別の Supabase プロジェクト**（ジムボードは `rrbfwitprzuevzytykrq`）。
 * 画像はそちらのストレージに置いてある。
 *
 * 2026-09-05 に `avatarSystem.ts` から移した。元はドット絵アバターと同じ置き場を
 * 使っていたが、アバター（ゲーム要素）を撤去しても**部位アイコンは生きた機能**なので、
 * 定数だけをこちらへ持ってきた。
 */
const MUSCLE_ICON_CDN_BASE =
  "https://clsvdhovzqrkojvkvekw.supabase.co/storage/v1/object/public/avatars";

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
  "お尻": "glutes",
  "腕": "biceps",
  "二頭筋": "biceps",
  "上腕二頭筋": "biceps",
  "三頭筋": "triceps",
  "上腕三頭筋": "triceps",
  "腹筋": "abs",
  "体幹・腹筋": "abs",
  "脚・臀部": "legs",
};

// 複数の筋肉にまたがる曖昧なラベル。種目名キーワードで細分化を試みる
// （例:「腕」→ アームカールなら二頭筋、キックバックなら三頭筋）。
const AMBIGUOUS_GROUPS = new Set(["腕", "脚・臀部"]);

export function getMuscleKey(exerciseName: string, muscleGroup?: string | null): MuscleKey | null {
  // 部位（muscle_group）が明示されていればそれを優先し、バッジ表示と画像を一致させる。
  // 例: スミスブルガリアンスクワットを「お尻」で登録 → キーワードの「脚」ではなくお尻の画像。
  const groupKey = muscleGroup ? GROUP_MAP[muscleGroup] : undefined;
  if (groupKey && !AMBIGUOUS_GROUPS.has(muscleGroup!)) return groupKey;
  for (const { keywords, muscle } of KEYWORD_MAP) {
    if (keywords.some((kw) => exerciseName.includes(kw))) return muscle;
  }
  return groupKey ?? null;
}

export function getMuscleIconUrl(
  exerciseName: string,
  gender: "male" | "female" | null | undefined,
  muscleGroup?: string | null
): string | null {
  const key = getMuscleKey(exerciseName, muscleGroup);
  if (!key) return null;
  const safeGender: "male" | "female" = gender === "female" ? "female" : "male";
  return `${MUSCLE_ICON_CDN_BASE}/muscle-icons/${key}_${safeGender}.png`;
}
