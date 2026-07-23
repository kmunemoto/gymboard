import { supabase } from "@/integrations/supabase/client";

/**
 * ジムごとに編集可能な「部位」一覧の読み込み・キャッシュ。
 * `muscleGroup.ts` の loadMuscleGroupMap と同じ購読パターン（モジュール単位のキャッシュ+
 * listeners）。RLS (`tenant_id = get_my_tenant_id()`) が自動的に呼び出し元自身のテナントに
 * 絞り込むため、クライアント側で tenant_id を明示的に渡す必要はない。
 */

// 新規テナント作成時のシード値、および読み込み前のフォールバック表示に使う既定の部位一覧。
// 既存テナントのバックフィル値（マイグレーション 20260723080000）と同じ並び。
export const DEFAULT_TENANT_MUSCLE_GROUPS = [
  "胸", "背中", "肩", "脚", "お尻", "二頭筋", "三頭筋", "腹筋",
] as const;

interface MuscleGroupRow {
  id: string;
  name: string;
  sort_order: number;
}

let cache: MuscleGroupRow[] = DEFAULT_TENANT_MUSCLE_GROUPS.map((name, i) => ({
  id: name,
  name,
  sort_order: i,
}));
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const subscribeTenantMuscleGroups = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const isTenantMuscleGroupsLoaded = () => loaded;

/** 現在キャッシュされている部位一覧（並び順）。名前だけ欲しい場合は .map(g => g.name)。 */
export const getTenantMuscleGroups = (): MuscleGroupRow[] => cache;

/**
 * DBから部位一覧を読み込み(または再読込)する。force=true で強制再取得
 * (追加・改名・削除の直後に呼ぶ)。
 */
export const loadTenantMuscleGroups = async (force = false): Promise<MuscleGroupRow[]> => {
  if (loadPromise && !force) {
    await loadPromise;
    return cache;
  }
  loadPromise = (async () => {
    const { data, error } = await supabase
      .from("tenant_muscle_groups" as any)
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true });
    if (!error && data && data.length > 0) {
      cache = data as unknown as MuscleGroupRow[];
    }
    loaded = true;
    listeners.forEach((cb) => cb());
  })();
  try {
    await loadPromise;
  } finally {
    if (force) loadPromise = null;
  }
  return cache;
};

if (typeof window !== "undefined") {
  loadTenantMuscleGroups().catch(() => {});
}
