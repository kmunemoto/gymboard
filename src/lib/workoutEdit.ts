// お客様のトレーニング記録編集（WorkoutEditModal）で、入力（文字列の重量・回数）から
// DB 更新用の値（sets / weight / reps）を組み立てる純関数。UIから切り離してテスト可能にする。

export interface WorkoutSetInput {
  weight: string;
  reps: string;
}

export interface WorkoutSet {
  set: number;
  weight: number;
  reps: number;
}

export interface WorkoutSetsUpdate {
  /** 有効なセットが1つ以上あるか（0件なら保存させない） */
  valid: boolean;
  /** 1始まりで採番し直した有効セット */
  sets: WorkoutSet[];
  /** 先頭セットの重量（従来カラム互換・グラフ用）。無効なら null */
  weight: number | null;
  /** 先頭セットの回数。無効なら null */
  reps: number | null;
}

/**
 * 入力セット配列から DB 更新用の {sets, weight, reps} を作る。
 * - 重量・回数の両方が入力され、かつ数値として解釈できるセットのみ採用する
 *   （空欄・非数値は捨てる）。トレーナー側の保存条件と揃える。
 * - 採用セットが0件なら valid:false（保存させない）。
 * - 先頭セットを従来カラム weight/reps にも反映する（旧データ互換・成長グラフ用）。
 */
export function buildWorkoutSetsUpdate(inputs: WorkoutSetInput[]): WorkoutSetsUpdate {
  const valid = inputs.filter((s) => {
    if (s.weight.trim() === "" || s.reps.trim() === "") return false;
    return !Number.isNaN(parseFloat(s.weight)) && !Number.isNaN(parseInt(s.reps, 10));
  });
  if (valid.length === 0) return { valid: false, sets: [], weight: null, reps: null };
  const sets: WorkoutSet[] = valid.map((s, i) => ({
    set: i + 1,
    weight: parseFloat(s.weight),
    reps: parseInt(s.reps, 10),
  }));
  return { valid: true, sets, weight: sets[0].weight, reps: sets[0].reps };
}
