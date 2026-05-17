import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCircle, Send, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMessages, useUnreadBySender } from "@/hooks/useMessages";
import { format } from "date-fns";
import { formatJST } from "@/lib/timezone";

interface CustomerInfo {
  user_id: string;
  display_name: string | null;
  avatar_initial: string;
}

const TrainerMessages = () => {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<CustomerInfo[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [newMsg, setNewMsg] = useState("");
  const [lastMessages, setLastMessages] = useState<Record<string, { content: string; time: string }>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const { counts: unreadCounts } = useUnreadBySender();

  const { messages, sendMessage, markAsRead } = useMessages(selectedCustomerId);

  // Fetch customers - trainer can view all roles via RLS
  useEffect(() => {
    const fetchCustomers = async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "customer");
      if (!roles || roles.length === 0) return;

      const ids = roles.map((r) => r.user_id);
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

  // Fetch last message per customer
  const fetchLastMessages = useCallback(async () => {
    if (!user || customers.length === 0) return;
    const map: Record<string, { content: string; time: string }> = {};
    for (const c of customers) {
      const { data } = await supabase
        .from("messages")
        .select("content, created_at")
        .or(
          `and(sender_id.eq.${user.id},receiver_id.eq.${c.user_id}),and(sender_id.eq.${c.user_id},receiver_id.eq.${user.id})`
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (data) {
        map[c.user_id] = {
          content: data.content,
          time: formatJST(data.created_at, "HH:mm"),
        };
      }
    }
    setLastMessages(map);
  }, [user, customers]);

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

  const handleSend = async () => {
    if (!newMsg.trim() || !selectedCustomerId) return;
    await sendMessage(newMsg.trim(), selectedCustomerId);
    setNewMsg("");
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
        メッセージ
      </h1>

      <div className="md:grid md:grid-cols-[320px_1fr] md:gap-4 md:h-[calc(100vh-180px)]">
        {/* Conversation list */}
        <Card className={`overflow-hidden ${selectedCustomerId ? "hidden md:block" : ""}`}>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {sortedCustomers.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">顧客がまだ登録されていません</p>
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
                        <p className="font-bold text-sm truncate">{cust.display_name || "顧客"}</p>
                        <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                          {last?.time || ""}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {last?.content || "メッセージなし"}
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
              <p className="font-bold text-sm">{selected?.display_name || "顧客"}</p>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground text-sm mt-8">
                  メッセージ履歴がありません
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
                      <p className="text-sm">{msg.content}</p>
                      <p className={`text-[10px] mt-1 ${isTrainer ? "opacity-70" : "text-muted-foreground"}`}>
                        {formatJST(msg.created_at, "M/d HH:mm")}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-2 sm:p-3 border-t border-border flex gap-2">
              <textarea
                placeholder="メッセージを入力..."
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
              <Button variant="accent" size="icon" onClick={handleSend} className="shrink-0 h-11 w-11">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="hidden md:flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">左のリストから会話を選択してください</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

export default TrainerMessages;
