import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface MessageTemplate {
  id: string;
  tenant_id: string;
  title: string;
  body: string;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateDraft {
  title: string;
  body: string;
}

/** チップとして並べる上限。増やしすぎると入力欄の上が埋まって本末転倒。 */
export const MAX_TEMPLATES = 12;

/**
 * ジム側の定型文。テナント単位で、trainer だけが読み書きできる（RLS）。
 *
 * ⚠️ 並び順は `sort_order` の昇順、同値なら作成順。並べ替えは「1つ上へ / 1つ下へ」だけ
 *    にしてある（ドラッグ&ドロップはモバイルでチャット画面と競合する）。
 */
export const useMessageTemplates = () => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTemplates = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("message_templates")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      console.error("定型文の取得に失敗:", error);
      setTemplates([]);
    } else {
      setTemplates((data ?? []) as MessageTemplate[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const create = async (draft: TemplateDraft) => {
    if (!user) return;
    const { fetchMyTenantId, withTenant } = await import("@/lib/tenantHelper");
    const tenantId = await fetchMyTenantId();
    // 末尾に足す。既存の並びを崩さない。
    const nextOrder = templates.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
    const { error } = await supabase.from("message_templates").insert(
      withTenant(
        {
          title: draft.title.trim(),
          body: draft.body.trim(),
          sort_order: nextOrder,
          created_by: user.id,
        },
        tenantId,
      ) as any,
    );
    if (error) throw error;
    await fetchTemplates();
  };

  const update = async (id: string, draft: TemplateDraft) => {
    const { error } = await supabase
      .from("message_templates")
      .update({
        title: draft.title.trim(),
        body: draft.body.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
    await fetchTemplates();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("message_templates").delete().eq("id", id);
    if (error) throw error;
    await fetchTemplates();
  };

  /**
   * 1つ上／下へ動かす。
   *
   * ⚠️ 既存行の sort_order は**同じ値が並んでいることがある**（既定 0 のまま作られた等）。
   *    入れ替えるだけだと動かないので、**表示順に 0..n を振り直してから**隣と入れ替える。
   */
  const move = async (id: string, direction: -1 | 1) => {
    const index = templates.findIndex((t) => t.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= templates.length) return;

    const reordered = [...templates];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    const updates = reordered
      .map((t, i) => ({ id: t.id, sort_order: i }))
      .filter(({ id: tid, sort_order }) => {
        const before = templates.find((t) => t.id === tid);
        return before?.sort_order !== sort_order;
      });

    for (const u of updates) {
      const { error } = await supabase
        .from("message_templates")
        .update({ sort_order: u.sort_order })
        .eq("id", u.id);
      if (error) throw error;
    }
    await fetchTemplates();
  };

  return {
    templates,
    loading,
    /** これ以上増やせないか（管理UIで「追加」を止める） */
    atLimit: templates.length >= MAX_TEMPLATES,
    create,
    update,
    remove,
    move,
    refetch: fetchTemplates,
  };
};
