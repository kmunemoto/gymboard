import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { uniqueChannelName } from "@/lib/realtimeChannel";
import {
  type AttachmentType,
  type PreparedAttachment,
  signAttachmentUrls,
} from "@/lib/messageAttachment";

export interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  read: boolean;
  created_at: string;
  /** 添付のバケット内パス。無ければ null */
  attachment_path: string | null;
  /** "image" | "video"。attachment_path とは必ずセット（DBの CHECK 制約） */
  attachment_type: AttachmentType | null;
  /**
   * 表示用の署名URL。**DBの列ではない**（クライアントで付ける）。
   * 期限があるので保存しないこと。
   */
  attachment_url?: string;
}

/**
 * 添付のある行に署名URLを付ける。バケットが非公開なので、これが無いと表示できない。
 * **まとめて1回だけ署名する**（1件ずつ createSignedUrl を呼ぶと添付の数だけ往復する）。
 */
async function withSignedUrls(rows: Message[]): Promise<Message[]> {
  const paths = rows.map((m) => m.attachment_path).filter((p): p is string => !!p);
  if (paths.length === 0) return rows;
  const signed = await signAttachmentUrls(paths);
  return rows.map((m) =>
    m.attachment_path ? { ...m, attachment_url: signed.get(m.attachment_path) } : m,
  );
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
    if (data) setMessages(await withSignedUrls(data as Message[]));
    setLoading(false);
  }, [user, otherUserId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Realtime subscription
  useEffect(() => {
    if (!user || !otherUserId) return;
    const belongsHere = (msg: Message) =>
      (msg.sender_id === user.id && msg.receiver_id === otherUserId) ||
      (msg.sender_id === otherUserId && msg.receiver_id === user.id);

    const channel = supabase
      .channel(uniqueChannelName(`messages-${otherUserId}`))
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          // Only add if it's part of this conversation
          if (!belongsHere(msg)) return;
          // 添付付きで届いた場合、署名URLはこちらで付ける（Realtime の payload には無い）。
          // 署名は非同期なので、まず本文だけ出してから URL を差し替える。
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (msg.attachment_path) {
            void signAttachmentUrls([msg.attachment_path]).then((signed) => {
              const url = signed.get(msg.attachment_path!);
              if (!url) return;
              setMessages((prev) =>
                prev.map((m) => (m.id === msg.id ? { ...m, attachment_url: url } : m)),
              );
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          // 🔴 既読（read）が相手側で立ったことを、送信者の開いている画面に反映する。
          //
          // ここが INSERT だけを購読していたため、`read` は DB にもあり Realtime も
          // 流れているのに、**送信者の画面だけ永久に更新されなかった**。
          // 「既読」を出すには、この UPDATE を拾うことが前提になる。
          const msg = payload.new as Message;
          if (!belongsHere(msg)) return;
          // attachment_url は DB の列ではないので payload に無い。
          // 素直に上書きすると、既読が立った瞬間に**添付が消える**。
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, ...msg, attachment_url: m.attachment_url } : m)),
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, otherUserId]);

  /**
   * @param attachment すでにアップロード済みの添付（`uploadAttachment` の戻り値）。
   *   アップロードは呼び出し元が先に済ませる。**行の INSERT が失敗しても
   *   ファイルだけ残る**ので、失敗時は呼び出し元が `discardAttachment` で片付けること。
   */
  const sendMessage = async (
    content: string,
    receiverId: string,
    attachment?: PreparedAttachment | null,
  ) => {
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
        attachment_path: attachment?.path ?? null,
        attachment_type: attachment?.type ?? null,
      }, tenantId) as any)
      .select()
      .single();
    if (error) throw error;

    // Realtimeの往復を待たず、送信者自身の画面には送信直後にローカル反映する。
    // Realtimeの購読が確立前/瞬断中だと、送った本人にすら表示されない問題があったため。
    if (data) {
      const sent = (await withSignedUrls([data as Message]))[0];
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
    }

    // 🔴 通知はここから送らない（2026-08-11）。
    //
    // 以前はここで LINE とプッシュを fire-and-forget していた。つまり
    // **送信者の端末が通知を投げていた**ので、送信直後にアプリを閉じる・
    // 画面を切り替える・電波が切れる、のどれでも**通知が飛ばなかった**。
    // 失敗しても console に出るだけで、送った本人にも受け取る側にも分からない。
    //
    // いまは messages の AFTER INSERT トリガー（notify_new_message）が
    // Edge Function `notify-new-message` を叩く。行が入った時点で確定するので、
    // このあと端末がどうなろうと通知は飛ぶ。
    // ⚠️ ここに通知を書き戻すと**二重に鳴る**。足すなら Edge Function 側に。
  };

  const markAsRead = async () => {
    if (!user || !otherUserId) return;
    // 呼び出し元は messages が変わるたびに呼ぶ。未読が1件も無いなら書きにいかない
    // （0行 UPDATE でも往復は発生するため）。
    const hasUnread = messages.some(
      (m) => m.sender_id === otherUserId && m.receiver_id === user.id && !m.read,
    );
    if (!hasUnread) return;
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
      .channel(uniqueChannelName("unread-global"))
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
      .channel(uniqueChannelName("unread-by-sender"))
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
