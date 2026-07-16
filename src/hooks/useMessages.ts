import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
}

export const useMessages = (otherUserId: string | null) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = useCallback(async () => {
    if (!user || !otherUserId) return;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .or(
        `and(sender_id.eq.${user.id},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${user.id})`
      )
      .order("created_at", { ascending: true });
    if (data) setMessages(data as Message[]);
    setLoading(false);
  }, [user, otherUserId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Realtime subscription
  useEffect(() => {
    if (!user || !otherUserId) return;
    const channel = supabase
      .channel(`messages-${otherUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          // Only add if it's part of this conversation
          if (
            (msg.sender_id === user.id && msg.receiver_id === otherUserId) ||
            (msg.sender_id === otherUserId && msg.receiver_id === user.id)
          ) {
            // sendMessage 側の即時ローカル反映と重複しないよう id で除外する
            setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, otherUserId]);

  const sendMessage = async (content: string, receiverId: string) => {
    if (!user) return;
    const { fetchMyTenantId, withTenant } = await import("@/lib/tenantHelper");
    const tenantId = await fetchMyTenantId();
    // withTenant はテナント未所属なら例外を投げる。以前はここが未捕捉のまま呼び出し元
    // （CustomerChat.handleSend）にもcatchが無く、送信が「何も起きず」に静かに失敗していた。
    const { data, error } = await supabase
      .from("messages")
      .insert(withTenant({
        sender_id: user.id,
        receiver_id: receiverId,
        content,
      }, tenantId) as any)
      .select()
      .single();
    if (error) throw error;

    // Realtimeの往復を待たず、送信者自身の画面には送信直後にローカル反映する。
    // Realtimeの購読が確立前/瞬断中だと、送った本人にすら表示されない問題があったため。
    if (data) {
      const sent = data as Message;
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
    }

    // Fire-and-forget: send LINE + push notification to receiver
    (async () => {
      try {
        // Get sender's display name
        const { data: senderProfile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .maybeSingle();

        const senderName = senderProfile?.display_name || "不明";
        const preview = content.length > 20 ? content.slice(0, 20) + "..." : content;
        const lineMessage = `【ジムボード】新着メッセージが届きました！\n送信者: ${senderName}\n『${preview}』\n詳細はアプリからご確認ください。`;

        await supabase.functions.invoke("send-line-message", {
          body: { user_id: receiverId, message: lineMessage },
        });
      } catch (e) {
        console.error("LINE notification failed (non-blocking):", e);
      }
    })();

    // Fire-and-forget: web push to receiver
    (async () => {
      try {
        const { data: senderProfile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .maybeSingle();
        const senderName = senderProfile?.display_name || "メッセージ";
        const preview = content.length > 20 ? content.slice(0, 20) + "..." : content;
        await supabase.functions.invoke("send-push-notification", {
          body: {
            user_ids: [receiverId],
            title: `${senderName}さんからメッセージ`,
            body: preview,
            url: "/",
            tag: `chat-${user.id}-${receiverId}`,
          },
        });
      } catch (e) {
        console.error("Push notification failed (non-blocking):", e);
      }
    })();
  };

  const markAsRead = async () => {
    if (!user || !otherUserId) return;
    await supabase
      .from("messages")
      .update({ read: true })
      .eq("sender_id", otherUserId)
      .eq("receiver_id", user.id)
      .eq("read", false);
  };

  return { messages, loading, sendMessage, markAsRead };
};

// Hook to get unread message count for current user
export const useUnreadCount = () => {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!user) return;
    const { count: c } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("receiver_id", user.id)
      .eq("read", false);
    setCount(c ?? 0);
  }, [user]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // Realtime for new messages
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("unread-global")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          if (msg.receiver_id === user.id) {
            setCount((prev) => prev + 1);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          if (msg.receiver_id === user.id && msg.read) {
            setCount((prev) => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return { count, refetch: fetchCount };
};

// Hook to get unread counts per sender (for trainer conversation list)
export const useUnreadBySender = () => {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});

  const fetchCounts = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("messages")
      .select("sender_id")
      .eq("receiver_id", user.id)
      .eq("read", false);
    if (data) {
      const map: Record<string, number> = {};
      data.forEach((m: { sender_id: string }) => {
        map[m.sender_id] = (map[m.sender_id] || 0) + 1;
      });
      setCounts(map);
    }
  }, [user]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("unread-by-sender")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => {
          fetchCounts();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchCounts]);

  return { counts, refetch: fetchCounts };
};
