import { useState, useEffect, useRef } from "react";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMessages } from "@/hooks/useMessages";
import { format } from "date-fns";
import { formatJST } from "@/lib/timezone";

const CustomerChat = () => {
  const { user } = useAuth();
  const [trainerId, setTrainerId] = useState<string | null>(null);
  const [trainerName, setTrainerName] = useState("コーチ");
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch trainer user id using security definer function
  useEffect(() => {
    const fetchTrainer = async () => {
      const { data } = await supabase.rpc("get_trainer_ids");
      if (data && data.length > 0) {
        const tid = data[0].user_id;
        setTrainerId(tid);
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name")
          .eq("user_id", tid)
          .single();
        if (profile?.display_name) setTrainerName(profile.display_name);
      }
    };
    fetchTrainer();
  }, []);

  const { messages, sendMessage, markAsRead } = useMessages(trainerId);

  // Mark messages as read when viewing
  useEffect(() => {
    markAsRead();
  }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !trainerId) return;
    await sendMessage(input.trim(), trainerId);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // On mobile, Enter always inserts newline. On PC, Enter sends, Shift+Enter inserts newline.
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    if (e.key === "Enter" && !e.shiftKey && !isMobile && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  // Group messages by date
  const getDateLabel = (dateStr: string) => {
    return formatJST(dateStr, "M/d");
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] slide-up">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full gym-gradient flex items-center justify-center text-primary-foreground font-bold text-sm">
            {trainerName.charAt(0)}
          </div>
          <div>
            <p className="font-bold text-sm">{trainerName}</p>
            <p className="text-xs text-success font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-success rounded-full inline-block" />
              オンライン
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-8">
            メッセージを送ってみましょう！
          </div>
        )}
        {messages.map((msg, i) => {
          const dateLabel = getDateLabel(msg.created_at);
          const prevDateLabel = i > 0 ? getDateLabel(messages[i - 1].created_at) : null;
          const showDate = i === 0 || dateLabel !== prevDateLabel;
          const isMe = msg.sender_id === user?.id;

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="text-center my-3">
                  <span className="text-[10px] text-muted-foreground bg-muted px-3 py-1 rounded-full font-medium">
                    {dateLabel}
                  </span>
                </div>
              )}
              <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${
                    isMe
                      ? "accent-gradient text-accent-foreground rounded-br-md"
                      : "bg-card border border-border rounded-bl-md shadow-sm"
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                  <p className={`text-[10px] mt-1 ${isMe ? "text-accent-foreground/60" : "text-muted-foreground"}`}>
                    {formatJST(msg.created_at, "HH:mm")}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border glass">
        <div className="flex items-center gap-2">
          <textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            rows={1}
            className="flex-1 bg-secondary rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground resize-none overflow-y-auto"
            style={{ maxHeight: 120 }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl accent-gradient flex items-center justify-center text-accent-foreground disabled:opacity-40 transition-opacity shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerChat;
