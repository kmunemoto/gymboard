import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchMyTenantId, withTenant } from "@/lib/tenantHelper";

// ジムが配る動画（自宅ストレッチ等）の読み書き。
//
// 動画ファイルは持たない。YouTube / Vimeo の限定公開URLを1列持つだけで、
// 埋め込みURLは src/lib/videoEmbed.ts が組み立て直す（生URLを iframe に入れない）。
// 経緯は supabase/migrations/20260831010000_gym_videos.sql の冒頭。
//
// 🔴 published_at が未来の行はお客様には**RLS で**見えない。
//    クライアント側の `.lte()` は表示を揃えるための二重掛けであって、
//    これが唯一の防壁ではない（お知らせと同じ作り）。

export interface GymVideo {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  video_url: string;
  category: string;
  duration_seconds: number | null;
  sort_order: number;
  published_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** 保存する項目（tenant_id / 日時はここでは触らない） */
export interface GymVideoInput {
  title: string;
  description: string | null;
  video_url: string;
  category: string;
  duration_seconds: number | null;
  sort_order: number;
  published_at: string;
}

const SELECT_COLS =
  "id,tenant_id,title,description,video_url,category,duration_seconds,sort_order,published_at,created_by,created_at,updated_at";

interface Options {
  /** トレーナー画面用。予約公開中（published_at が未来）の行も含める */
  includeUnpublished?: boolean;
  /** false の間は問い合わせない（ダイアログが閉じているとき等） */
  enabled?: boolean;
}

export const useGymVideos = ({ includeUnpublished = false, enabled = true }: Options = {}) => {
  const [items, setItems] = useState<GymVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    let q = supabase
      .from("gym_videos")
      .select(SELECT_COLS)
      .order("sort_order", { ascending: true })
      .order("published_at", { ascending: false });
    if (!includeUnpublished) q = q.lte("published_at", new Date().toISOString());
    const { data, error: err } = await q;
    if (err) {
      // 列が無い（マイグレーション未適用）等をその場で見えるようにする
      console.error("動画一覧の取得に失敗:", err);
      setError(err.message);
      setItems([]);
    } else {
      setError(null);
      setItems((data as unknown as GymVideo[] | null) ?? []);
    }
    setLoading(false);
  }, [includeUnpublished, enabled]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const create = async (input: GymVideoInput) => {
    const tenantId = await fetchMyTenantId();
    const { error: err } = await supabase
      .from("gym_videos")
      .insert(withTenant(input, tenantId) as never);
    if (err) throw err;
    await fetchAll();
  };

  const update = async (id: string, input: GymVideoInput) => {
    // 🔴 tenant_id は payload に入れない（付け替えを許さない）。
    //    RESTRICTIVE な tenant_isolation の WITH CHECK でも弾かれるが、送らないのが先。
    const { error: err } = await supabase
      .from("gym_videos")
      .update(input as never)
      .eq("id", id);
    if (err) throw err;
    await fetchAll();
  };

  const remove = async (id: string) => {
    const { error: err } = await supabase.from("gym_videos").delete().eq("id", id);
    if (err) throw err;
    await fetchAll();
  };

  return { items, loading, error, refetch: fetchAll, create, update, remove };
};

/**
 * 公開中の動画が何本あるか。ホーム画面の入口カードを出すかどうかの判定に使う。
 *
 * 🔴 お客様側にはジムごとの表示ON/OFFの仕組みが無い（show_nav_* は全部トレーナー画面用）。
 *    そのため入口を無条件に置くと、動画を1本も入れていない18のジムにも
 *    空っぽの導線が生える。**0本なら出さない**ことで、新しいフラグを増やさずに済ませる。
 */
export const useGymVideoCount = () => {
  const [count, setCount] = useState(0);

  const refetch = useCallback(async () => {
    const { count: c, error } = await supabase
      .from("gym_videos")
      .select("id", { count: "exact", head: true })
      .lte("published_at", new Date().toISOString());
    // 失敗（未適用環境など）は 0 扱い＝カードを出さない。壊れた導線を出すよりよい
    setCount(error ? 0 : c ?? 0);
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { count, refetch };
};
