import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, Send, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMessages, useUnreadBySender } from "@/hooks/useMessages";
import { useAttachmentPicker } from "@/hooks/useAttachmentPicker";
import MessageAttachment from "@/components/messages/MessageAttachment";
import { AttachmentButton, AttachmentPreview } from "@/components/messages/AttachmentComposer";
import { format } from "date-fns";
import { formatJST } from "@/lib/timezone";
import { toast } from "sonner";

interface CustomerInfo {
  user_id: string;
  display_name: string | null;
  avatar_initial: string;
}

interface MessageRow {
  sender_id: string;
  receiver_id: string;
  content: string;
  attachment_type: string | null;
  created_at: string;
}

/**
 * 会話プレビューを作るために遡るメッセージ件数。
 * これより古い会話しかない相手はプレビューが空になる（一覧からは消えない）。
 * 相手ごとに1クエリ投げる N+1 に戻すよりは、ここを上げるほうが安い。
 */
const LAST_MESSAGE_SCAN_LIMIT = 1000;

interface TrainerMessagesProps {
  /** 開いたときに選択しておく顧客（離脱アラートの「声かけ」等からの遷移用） */
  initialCustomerId?: string | null;
}

const TrainerMessages = ({ initialCustomerId = null }: TrainerMessagesProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(initialCustomerId);
  const [newMsg, setNewMsg] = useState("");
  const [lastMessages, setLastMessages] = useState<Record<string, { content: string; time: string }>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const { counts: unreadCounts } = useUnreadBySender();

  const { messages, sendMessage, markAsRead } = useMessages(selectedCustomerId);
  const attachment = useAttachmentPicker(user?.id);

  // 会話相手は「自テナントに在籍しているお客様」。
  //
  // ⚠️ 以前は user_roles を role=customer で**全テナント横断**に引き、status も見ていなかった。
  //    そのため 2026-08-10 に入れた退会・休会が一覧に反映されず、**退会した人が
  //    会話相手として並び続けていた**。useProfile の顧客一覧と同じ条件に揃える。
  //    休会（suspended）は残す。休会にした瞬間に消えるのは「休会」ではなく「消滅」。
  useEffect(() => {
    const fetchCustomers = async () => {
      const { fetchMyTenantId } = await import("@/lib/tenantHelper");
      const tenantId = await fetchMyTenantId();
      if (!tenantId) return;

      const { data: members } = await supabase
        .from("tenant_members")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("role", "customer")
        .in("status", ["active", "suspended"]);
      if (!members || members.length === 0) {
        setCustomers([]);
        return;
      }

      const ids = members.map((m: { user_id: string }) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);

      if (profiles) {
        setCustomers(
          profiles.map((p) => ({
            user_id: p.user_id,
            display_name: p.display_name,
            avatar_initial: (p.display_name || "?").charAt(0),
          }))
        );
      }
    };
    fetchCustomers();
  }, []);

  // 各会話の最終メッセージ。
  //
  // ⚠️ 以前は **顧客1人につき1クエリ**（N+1）を直列で回していた。30人いれば30往復で、
  //    画面を開くたびにプレビューが1件ずつ遅れて出てくる状態だった。
  //    自分が関わるメッセージを新しい順に1回だけ引き、相手ごとの先頭を採る。
  const fetchLastMessages = useCallback(async () => {
    if (!user || customers.length === 0) return;
    const { data } = await supabase
      .from("messages")
      .select("sender_id, receiver_id, content, attachment_type, created_at")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(LAST_MESSAGE_SCAN_LIMIT);

    const map: Record<string, { content: string; time: string }> = {};
    for (const row of (data ?? []) as MessageRow[]) {
      const other = row.sender_id === user.id ? row.receiver_id : row.sender_id;
      // 新しい順に見ているので、最初に現れたものがその相手の最終メッセージ
      if (map[other]) continue;
      // 添付だけのメッセージは本文が空。プレビューが空欄になると
      //「メッセージなし」と見分けがつかないので、種別を文言にする。
      const text = row.content.trim()
        ? row.content
        : row.attachment_type === "video"
          ? t("trainerMessages.previewVideo")
          : row.attachment_type === "image"
            ? t("trainerMessages.previewImage")
            : row.content;
      map[other] = { content: text, time: formatJST(row.created_at, "HH:mm") };
    }
    setLastMessages(map);
  }, [user, customers, t]);

  useEffect(() => {
    fetchLastMessages();
  }, [fetchLastMessages]);

  // Mark as read when selecting conversation
  useEffect(() => {
    if (selectedCustomerId) markAsRead();
  }, [selectedCustomerId, messages]);

  // Scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 添付だけ送るのは正しい操作。アップロード中は送らせない
  // （行だけ先に入って添付が付かない状態を作らない）。
  const canSend =
    (!!newMsg.trim() || !!attachment.prepared) && !attachment.uploading && !!selectedCustomerId;

  const handleSend = async () => {
    if (!canSend || !selectedCustomerId) return;
    const text = newMsg.trim();
    try {
      await sendMessage(text, selectedCustomerId, attachment.prepared);
      setNewMsg("");
      attachment.consume();
    } catch (e) {
      // 以前は例外が未捕捉のまま送信が黙って失敗していた（useMessages.sendMessage 参照）。
      console.error("メッセージの送信に失敗:", e);
      toast.error(t("trainerMessages.sendFailed"));
    }
  };

  const selected = customers.find((c) => c.user_id === selectedCustomerId);

  // Sort customers: those with unread messages first
  const sortedCustomers = [...customers].sort((a, b) => {
    const aUnread = unreadCounts[a.user_id] || 0;
    const bUnread = unreadCounts[b.user_id] || 0;
    return bUnread - aUnread;
  });

  return (
    <div className="pb-24 md:pb-0">
      <h1 className="text-lg sm:text-xl font-bold flex items-center gap-2 mb-4 sm:mb-6">
        <MessageCircle className="w-5 h-5 text-accent" />
        {t("trainerMessages.title")}
      </h1>

      <div className="md:grid md:grid-cols-[320px_1fr] md:gap-4 md:h-[calc(100vh-180px)]">
        {/* Conversation list */}
        <Card className={`overflow-hidden ${selectedCustomerId ? "hidden md:block" : ""}`}>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {sortedCustomers.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">{t("trainerMessages.noCustomers")}</p>
              )}
              {sortedCustomers.map((cust) => {
                const unread = unreadCounts[cust.user_id] || 0;
                const last = lastMessages[cust.user_id];
                return (
                  <button
                    key={cust.user_id}
                    onClick={() => setSelectedCustomerId(cust.user_id)}
                    className={`w-full p-3 sm:p-4 flex items-center gap-3 text-left transition-colors hover:bg-muted/50 min-h-[60px] ${
                      selectedCustomerId === cust.user_id ? "bg-accent/10" : ""
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl gym-gradient flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0 relative">
                      {cust.avatar_initial}
                      {unread > 0 && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                          {unread}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline">
                        <p className="font-bold text-sm truncate">{cust.display_name || t("common.customer")}</p>
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                          {last?.time || ""}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {last?.content || t("trainerMessages.noMessagePreview")}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Chat area */}
        {selectedCustomerId ? (
          <Card className="flex flex-col overflow-hidden h-[calc(100vh-200px)] md:h-auto">
            {/* Chat header */}
            <div className="p-3 sm:p-4 border-b border-border flex items-center gap-3">
              <button onClick={() => setSelectedCustomerId(null)} className="md:hidden text-muted-foreground p-1">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="w-8 h-8 rounded-lg gym-gradient flex items-center justify-center text-primary-foreground font-bold text-xs">
                {selected?.avatar_initial}
              </div>
              <p className="font-bold text-sm">{selected?.display_name || t("common.customer")}</p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground text-sm mt-8">
                  {t("trainerMessages.noHistory")}
                </div>
              )}
              {messages.map((msg) => {
                const isTrainer = msg.sender_id === user?.id;
                return (
                  <div key={msg.id} className={`flex ${isTrainer ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[80%] sm:max-w-[75%] rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 ${
                        isTrainer
                          ? "accent-gradient text-accent-foreground rounded-br-md"
                          : "bg-muted rounded-bl-md"
                      }`}
                    >
                      {msg.attachment_type && (
                        <div className={msg.content.trim() ? "mb-1.5" : ""}>
                          <MessageAttachment type={msg.attachment_type} url={msg.attachment_url} />
                        </div>
                      )}
                      {msg.content.trim() && (
                        <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                      )}
                      <p
                        className={`text-[10px] mt-1 flex items-center gap-1.5 ${
                          isTrainer ? "justify-end opacity-70" : "text-muted-foreground"
                        }`}
                      >
                        {/* 既読は自分（ジム側）が送った分にだけ出す */}
                        {isTrainer && msg.read && <span>{t("common.messageRead")}</span>}
                        <span>{formatJST(msg.created_at, "M/d HH:mm")}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-2 sm:p-3 border-t border-border">
              {attachment.picked && (
                <AttachmentPreview
                  picked={attachment.picked}
                  uploading={attachment.uploading}
                  onRemove={attachment.clear}
                />
              )}
              <div className="flex gap-2 items-end">
              <AttachmentButton
                inputRef={attachment.inputRef}
                onPick={attachment.pick}
                onOpen={attachment.openPicker}
                disabled={attachment.uploading}
              />
              <textarea
                placeholder={t("customerChat.inputPlaceholder")}
                value={newMsg}
                onChange={(e) => {
                  setNewMsg(e.target.value);
                  const el = e.target;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }}
                onKeyDown={(e) => {
                  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
                  if (e.key === "Enter" && !e.shiftKey && !isMobile && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none overflow-y-auto"
                style={{ maxHeight: 120 }}
              />
              <Button
                variant="accent"
                size="icon"
                onClick={handleSend}
                disabled={!canSend}
                className="shrink-0 h-11 w-11"
              >
                <Send className="w-4 h-4" />
              </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="hidden md:flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t("trainerMessages.selectConversation")}</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default TrainerMessages;
