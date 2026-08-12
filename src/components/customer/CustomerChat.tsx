import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Send, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMessages } from "@/hooks/useMessages";
import { useAttachmentPicker } from "@/hooks/useAttachmentPicker";
import MessageAttachment from "@/components/messages/MessageAttachment";
import { AttachmentButton, AttachmentPreview } from "@/components/messages/AttachmentComposer";
import BookingQuoteChips from "@/components/messages/BookingQuoteChips";
import { useQuotableBookings } from "@/hooks/useQuotableBookings";
import { prependQuote } from "@/lib/messageQuote";
import { format } from "date-fns";
import { formatJST } from "@/lib/timezone";
import { toast } from "sonner";

const CustomerChat = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [trainerId, setTrainerId] = useState<string | null>(null);
  const [trainerName, setTrainerName] = useState(() => t("customerChat.defaultTrainer"));
  const [resolvingTrainer, setResolvingTrainer] = useState(true);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 送信先は「自分が所属するジムのスタッフ」を解決する。
  // 旧実装は get_trainer_ids()[0]（全テナント横断で先頭）だったため、他ジムのトレーナーに
  // メッセージが飛び、自ジムのオーナーに届かない不具合があった（fetchMyTenantTrainerId 参照）。
  //
  // ここが解決できない（テナント未所属・所属が非activeなど）場合、以前は何のエラーも
  // 出さずに既定の「コーチ」表示・空のチャットのまま固まり、送信ボタンも黙って
  // 無反応になっていた（handleSend の !trainerId ガードで無言return）。
  // resolvingTrainer で判別し、失敗時は明示的にエラーを表示する。
  useEffect(() => {
    const fetchTrainer = async () => {
      try {
        const { fetchMyTenantTrainerId } = await import("@/lib/tenantHelper");
        const tid = await fetchMyTenantTrainerId();
        if (tid) {
          setTrainerId(tid);
          const { data: profile } = await supabase
            .from("profiles")
            .select("display_name")
            .eq("user_id", tid)
            .maybeSingle();
          if (profile?.display_name) setTrainerName(profile.display_name);
        }
      } catch (e) {
        console.error("担当トレーナーの解決に失敗:", e);
      } finally {
        setResolvingTrainer(false);
      }
    };
    fetchTrainer();
  }, []);

  const { messages, sendMessage, markAsRead } = useMessages(trainerId);
  const attachment = useAttachmentPicker(user?.id);
  // お客様側は「自分の予約」を引用する（相手ではなく自分の user_id で引く）
  const { bookings: quotableBookings } = useQuotableBookings(user?.id ?? null);

  // Mark messages as read when viewing
  useEffect(() => {
    markAsRead();
  }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 添付だけを送る（本文が空）のは正しい操作。写真1枚だけ送りたいことのほうが多い。
  // ただしアップロード中は送らせない（行だけ先に入って添付が付かない状態を作らない）。
  const canSend = (!!input.trim() || !!attachment.prepared) && !attachment.uploading && !!trainerId;

  const handleSend = async () => {
    if (!canSend || !trainerId) return;
    const text = input.trim();
    const prepared = attachment.prepared;
    try {
      await sendMessage(text, trainerId, prepared);
      setInput("");
      attachment.consume();
    } catch (e) {
      // 以前はここで例外が捕捉されず、送信が黙って失敗し入力欄もそのままだった。
      console.error("メッセージの送信に失敗:", e);
      toast.error(t("customerChat.sendFailed"));
    }
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

  // 送信先スタッフが解決できない場合（テナント未所属・所属が非active等）は、
  // 何も起きていないように見える空チャットではなく、明示的にエラーを表示する。
  if (!resolvingTrainer && !trainerId) {
    return (
      <div className="flex flex-col h-[calc(100vh-8.5rem)] items-center justify-center px-6 text-center gap-2 slide-up">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <p className="text-sm font-bold">{t("customerChat.noTrainerFound")}</p>
        <p className="text-xs text-muted-foreground">{t("customerChat.noTrainerFoundHelp")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)] slide-up">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full gym-gradient flex items-center justify-center text-primary-foreground font-bold text-sm">
            {trainerName.charAt(0)}
          </div>
          {/* 🔴 「オンライン」表示は削除した（2026-08-11）。
              プレゼンスを一切見ておらず、**誰が見ても常に緑で「オンライン」**だった。
              深夜に送ったお客様に「オンラインなのに返事が来ない」と感じさせる嘘の表示。
              実プレゼンスを作るほどの価値は無いと判断し、表示ごと落とした。 */}
          <p className="font-bold text-sm">{trainerName}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-8">
            {t("customerChat.emptyPrompt")}
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
                  {msg.attachment_type && (
                    <div className={msg.content.trim() ? "mb-1.5" : ""}>
                      <MessageAttachment type={msg.attachment_type} url={msg.attachment_url} />
                    </div>
                  )}
                  {msg.content.trim() && (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
                  )}
                  <p
                    className={`text-[10px] mt-1 flex items-center gap-1.5 ${
                      isMe ? "justify-end text-accent-foreground/60" : "text-muted-foreground"
                    }`}
                  >
                    {/* 既読は自分が送った分にだけ出す。相手の吹き出しに出しても意味がない。
                        `read` は元から DB にあり、useMessages が UPDATE を購読するように
                        なって初めて画面に反映されるようになった。 */}
                    {isMe && msg.read && <span>{t("common.messageRead")}</span>}
                    <span>{formatJST(msg.created_at, "HH:mm")}</span>
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
        {/* 予約の引用。「この予約についてなんですが」を文脈付きで言えるようにする */}
        <BookingQuoteChips
          bookings={quotableBookings}
          onQuote={(q) => setInput((cur) => prependQuote(cur, q))}
        />
        {attachment.picked && (
          <AttachmentPreview
            picked={attachment.picked}
            uploading={attachment.uploading}
            onRemove={attachment.clear}
          />
        )}
        <div className="flex items-center gap-2">
          <AttachmentButton
            inputRef={attachment.inputRef}
            onPick={attachment.pick}
            onOpen={attachment.openPicker}
            disabled={attachment.uploading}
          />
          <textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={t("customerChat.inputPlaceholder")}
            rows={1}
            className="flex-1 bg-secondary rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/30 transition-all placeholder:text-muted-foreground resize-none overflow-y-auto"
            style={{ maxHeight: 120 }}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="w-10 h-10 rounded-xl accent-gradient flex items-center justify-center text-accent-foreground disabled:opacity-40 transition-opacity shadow-sm shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomerChat;
