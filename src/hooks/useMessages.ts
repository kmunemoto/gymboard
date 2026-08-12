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
   * 送信を取り消した時刻。null なら通常のメッセージ。
   * 取り消すと content は空・attachment_* は null になり、**行だけ残る**。
   */
  unsent_at: string | null;
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

export interface UseMessagesOptions {
  /**
   * 「こちら側」として扱う user_id の集合。既定は自分1人。
   * ジム側は**スタッフ全員**を渡す（共有受信箱）。
   */
  selfIds?: string[];
  /**
   * 「相手側」として扱う user_id の集合。既定は otherUserId 1人。
   * お客様側は**スタッフ全員**を渡す（誰が返しても同じ会話に見える）。
   */
  otherIds?: string[];
}

/** PostgREST の or() 用に、集合同士の会話条件を組み立てる。 */
const conversationFilter = (selfIds: string[], otherIds: string[]): string => {
  const inList = (ids: string[]) => `(${ids.join(",")})`;
  return [
    `and(sender_id.in.${inList(selfIds)},receiver_id.in.${inList(otherIds)})`,
    `and(sender_id.in.${inList(otherIds)},receiver_id.in.${inList(selfIds)})`,
  ].join(",");
};

/**
 * 1つの会話。
 *
 * ## 共有受信箱（2026-08-11）
 * 行は 1対1 のまま（`sender_id` / `receiver_id`）だが、**読むときに集合で束ねる**。
 * ジム側は `selfIds` にスタッフ全員を渡すことで、担当が誰であっても
 * 「そのお客様とジムの会話」1本として見える。データ移行は要らない。
 */
export const useMessages = (otherUserId: string | null, options?: UseMessagesOptions) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // 依存配列に配列をそのまま置くと毎レンダーで変わる。キーにして安定させる。
  const selfKey = (options?.selfIds ?? []).join(",");
  const otherKey = (options?.otherIds ?? []).join(",");

  const resolveSides = useCallback(() => {
    if (!user || !otherUserId) return null;
    const selfIds = [...new Set([user.id, ...(selfKey ? selfKey.split(",") : [])])];
    const otherIds = [...new Set([otherUserId, ...(otherKey ? otherKey.split(",") : [])])];
    // 自分がスタッフのとき、相手側にも自分が入ってしまうと「自分との会話」が混ざる。
    // こちら側を優先して相手側から除く。
    return { selfIds, otherIds: otherIds.filter((id) => !selfIds.includes(id)) };
  }, [user, otherUserId, selfKey, otherKey]);

  const fetchMessages = useCallback(async () => {
    const sides = resolveSides();
    if (!sides || sides.otherIds.length === 0) return;
    const { data } = await supabase
      .from("messages")
      .select("*")
      .or(conversationFilter(sides.selfIds, sides.otherIds))
      .order("created_at", { ascending: true });
    if (data) setMessages(await withSignedUrls(data as Message[]));
    setLoading(false);
  }, [resolveSides]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Realtime subscription
  useEffect(() => {
    const sides = resolveSides();
    if (!user || !otherUserId || !sides) return;
    const belongsHere = (msg: Message) =>
      (sides.selfIds.includes(msg.sender_id) && sides.otherIds.includes(msg.receiver_id)) ||
      (sides.otherIds.includes(msg.sender_id) && sides.selfIds.includes(msg.receiver_id));

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
  }, [user, otherUserId, resolveSides]);

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

  /**
   * 送信を取り消す（24時間以内・送信者本人のみ）。
   *
   * 可否の判断は **DB 側の `unsend_message`** が持つ。クライアントの
   * `canUnsend` はメニューを出すかどうかだけで、防御ではない
   * （端末の時計はずれるし、直接 RPC を叩かれれば素通りする）。
   *
   * ⚠️ 添付は**ストレージからも消す**。行から参照が外れた時点で受信者からは
   *    読めなくなる（ストレージのポリシーが messages を引いているため）が、
   *    ファイル自体は残ってしまう。
   */
  const unsendMessage = async (messageId: string) => {
    const { data: path, error } = await supabase.rpc("unsend_message", {
      _message_id: messageId,
    });
    if (error) throw error;

    if (path) {
      const { discardAttachment } = await import("@/lib/messageAttachment");
      // 消せなくても行の取り消しは成立している。ここで投げると
      // 「取り消せなかった」と誤解させるので、握って進む。
      await discardAttachment(path).catch((e) =>
        console.error("取り消した添付の削除に失敗:", e),
      );
    }

    // Realtime の UPDATE でも届くが、往復を待たず自分の画面には即反映する
    // （購読が確立前／瞬断中だと、押したのに何も起きないように見える）。
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              content: "",
              attachment_path: null,
              attachment_type: null,
              attachment_url: undefined,
              unsent_at: new Date().toISOString(),
            }
          : m,
      ),
    );
  };

  const markAsRead = async () => {
    const sides = resolveSides();
    if (!sides) return;
    // 呼び出し元は messages が変わるたびに呼ぶ。未読が1件も無いなら書きにいかない
    // （0行 UPDATE でも往復は発生するため）。
    //
    // ⚠️ 共有受信箱では「自分宛て」だけでなく**こちら側の誰か宛て**を既読にする。
    //    別のスタッフ宛てのまま残すと、開いて読んだのに未読が消えない。
    const unread = messages.filter(
      (m) => sides.otherIds.includes(m.sender_id) && sides.selfIds.includes(m.receiver_id) && !m.read,
    );
    if (unread.length === 0) return;
    await supabase
      .from("messages")
      .update({ read: true })
      .in("id", unread.map((m) => m.id));
  };

  return { messages, loading, sendMessage, markAsRead, unsendMessage };
};

/**
 * 未読数（バッジ用）。
 *
 * @param selfIds 「こちら側」として数える user_id。ジム側は**スタッフ全員**を渡す。
 *   渡さなければ自分宛てだけ（お客様側の挙動）。
 *
 * ⚠️ 共有受信箱では、別のスタッフ宛ての未読も自分のバッジに出す必要がある。
 *    出さないと「誰も気づかないまま溜まる」会話ができる。
 */
export const useUnreadCount = (selfIds?: string[]) => {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const selfKey = (selfIds ?? []).join(",");

  const receivers = useCallback(() => {
    if (!user) return [];
    return [...new Set([user.id, ...(selfKey ? selfKey.split(",") : [])])];
  }, [user, selfKey]);

  const fetchCount = useCallback(async () => {
    if (!user) return;
    const ids = receivers();
    const { count: c } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .in("receiver_id", ids)
      // 自分たちで送ったものは未読に数えない
      .not("sender_id", "in", `(${ids.join(",")})`)
      .eq("read", false);
    setCount(c ?? 0);
  }, [user, receivers]);

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
          const ids = receivers();
          // 自分たち（スタッフ）同士の行は未読に数えない
          if (ids.includes(msg.receiver_id) && !ids.includes(msg.sender_id)) {
            setCount((prev) => prev + 1);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          const ids = receivers();
          if (ids.includes(msg.receiver_id) && !ids.includes(msg.sender_id) && msg.read) {
            setCount((prev) => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, receivers]);

  return { count, refetch: fetchCount };
};

/**
 * 会話一覧の「相手ごとの未読数」。
 *
 * @param selfIds 「こちら側」として数える user_id。ジム側は**スタッフ全員**を渡す。
 *
 * ⚠️ 自分宛てだけで数えると、**別のスタッフ宛ての未読が一覧に出ない**。
 *    共有受信箱なのに、担当以外には「新着なし」に見えてしまう。
 */
export const useUnreadBySender = (selfIds?: string[]) => {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const selfKey = (selfIds ?? []).join(",");

  const fetchCounts = useCallback(async () => {
    if (!user) return;
    const ids = [...new Set([user.id, ...(selfKey ? selfKey.split(",") : [])])];
    const { data } = await supabase
      .from("messages")
      .select("sender_id")
      .in("receiver_id", ids)
      // スタッフ同士の行を「お客様からの未読」に数えない
      .not("sender_id", "in", `(${ids.join(",")})`)
      .eq("read", false);
    if (data) {
      const map: Record<string, number> = {};
      data.forEach((m: { sender_id: string }) => {
        map[m.sender_id] = (map[m.sender_id] || 0) + 1;
      });
      setCounts(map);
    }
  }, [user, selfKey]);

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
