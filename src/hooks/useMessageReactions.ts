import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uniqueChannelName } from "@/lib/realtimeChannel";
import {
  type Reaction,
  type ReactionKind,
  groupByMessage,
  isReactionKind,
} from "@/lib/messageReaction";

/**
 * 開いている会話のリアクション。
 *
 * ⚠️ **メッセージ1件ごとに引かない。** 会話のメッセージ id をまとめて渡し、
 *    1回で取る（添付の署名URLと同じ理由。N+1 にすると会話を開くたびに
 *    件数分の往復が出る）。
 */
export const useMessageReactions = (messageIds: string[]) => {
  const { user } = useAuth();
  const [reactions, setReactions] = useState<Reaction[]>([]);

  // 依存配列に配列をそのまま置くと毎レンダー変わる。キーにして安定させる。
  const idsKey = messageIds.join(",");

  const fetchReactions = useCallback(async () => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) {
      setReactions([]);
      return;
    }
    const { data } = await supabase
      .from("message_reactions")
      .select("message_id, user_id, kind")
      .in("message_id", ids);
    if (data) {
      setReactions(
        (data as { message_id: string; user_id: string; kind: string }[])
          // 知らない種別（後から DB に足された等）は描けないので落とす。
          .filter((r) => isReactionKind(r.kind))
          .map((r) => ({ ...r, kind: r.kind as ReactionKind })),
      );
    }
  }, [idsKey]);

  useEffect(() => {
    fetchReactions();
  }, [fetchReactions]);

  // 相手が押したものが自分の画面にも出るように。
  // 件数が変わるだけなので、細かく差分を当てず引き直す。
  useEffect(() => {
    if (!idsKey) return;
    const channel = supabase
      .channel(uniqueChannelName("message-reactions"))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        () => {
          fetchReactions();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [idsKey, fetchReactions]);

  const byMessage = groupByMessage(reactions);

  /**
   * 押す／押し直して外す。
   *
   * ⚠️ 先に画面へ反映してから書きにいく。押した瞬間に反応が無いと
   *    連打され、UNIQUE 制約で片方が落ちる。
   */
  const toggle = useCallback(
    async (messageId: string, kind: ReactionKind, tenantId: string | null) => {
      if (!user) return;
      const already = reactions.some(
        (r) => r.message_id === messageId && r.user_id === user.id && r.kind === kind,
      );

      setReactions((prev) =>
        already
          ? prev.filter(
              (r) => !(r.message_id === messageId && r.user_id === user.id && r.kind === kind),
            )
          : [...prev, { message_id: messageId, user_id: user.id, kind }],
      );

      try {
        if (already) {
          await supabase
            .from("message_reactions")
            .delete()
            .eq("message_id", messageId)
            .eq("user_id", user.id)
            .eq("kind", kind);
        } else {
          await supabase
            .from("message_reactions")
            .insert({ message_id: messageId, user_id: user.id, kind, tenant_id: tenantId } as never);
        }
      } catch (e) {
        console.error("リアクションの更新に失敗:", e);
        // 楽観表示を戻す（押せていないのに付いたままにしない）
        await fetchReactions();
      }
    },
    [user, reactions, fetchReactions],
  );

  return { byMessage, toggle, refetch: fetchReactions };
};
