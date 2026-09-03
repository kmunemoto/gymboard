import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Send, AlertTriangle, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMessages } from "@/hooks/useMessages";
import { useStaffDirectory } from "@/hooks/useStaffDirectory";
import { useAttachmentPicker } from "@/hooks/useAttachmentPicker";
import MessageAttachment from "@/components/messages/MessageAttachment";
import MessageText from "@/components/messages/MessageText";
import DateSeparator from "@/components/messages/DateSeparator";
import ImageLightbox from "@/components/messages/ImageLightbox";
import MessageActions from "@/components/messages/MessageActions";
import ReplyQuote from "@/components/messages/ReplyQuote";
import UnsentNotice from "@/components/messages/UnsentNotice";
import MessageReactions from "@/components/messages/MessageReactions";
import MessageSticker from "@/components/messages/MessageSticker";
import StickerPicker, { StickerPickerButton } from "@/components/messages/StickerPicker";
import ConversationSearch from "@/components/messages/ConversationSearch";
import { AttachmentButton, AttachmentPreview } from "@/components/messages/AttachmentComposer";
import BookingQuoteChips from "@/components/messages/BookingQuoteChips";
import { useQuotableBookings } from "@/hooks/useQuotableBookings";
import { useConversationSearch } from "@/hooks/useConversationSearch";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import KeyboardMetrics from "@/components/KeyboardMetrics";
import { prependQuote } from "@/lib/messageQuote";
import { formatReplyQuote, prependReply, splitReplyQuote } from "@/lib/messageReply";
import { canUnsend, isUnsent } from "@/lib/messageUnsend";
import { findSticker } from "@/lib/stickers";
import { useMessageReactions } from "@/hooks/useMessageReactions";
import { needsDateSeparator } from "@/lib/chatDate";
import { formatJST } from "@/lib/timezone";
import { toast } from "sonner";

const CustomerChat = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [trainerId, setTrainerId] = useState<string | null>(null);
  const [trainerName, setTrainerName] = useState(() => t("customerChat.defaultTrainer"));
  const [resolvingTrainer, setResolvingTrainer] = useState(true);
  const [input, setInput] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // キーボードの高さを --kb へ流す。チャットの bottom がこれを見て持ち上がる。
  const keyboardInset = useKeyboardInset();

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

  // 共有受信箱: 誰が返信しても同じ会話として見える（担当が休みでも途切れない）
  const staff = useStaffDirectory();
  const { messages, sendMessage, markAsRead, unsendMessage } = useMessages(trainerId, {
    otherIds: staff.ids,
  });
  const attachment = useAttachmentPicker(user?.id);
  // お客様側は「自分の予約」を引用する（相手ではなく自分の user_id で引く）
  const { bookings: quotableBookings } = useQuotableBookings(user?.id ?? null);
  const search = useConversationSearch(messages);
  const reactions = useMessageReactions(messages.map((m) => m.id));
  // リアクション行にもテナントを載せる（RESTRICTIVE な tenant_isolation を満たすため）
  const [tenantId, setTenantId] = useState<string | null>(null);
  useEffect(() => {
    void import("@/lib/tenantHelper").then(({ fetchMyTenantId }) =>
      fetchMyTenantId().then(setTenantId).catch(() => setTenantId(null)),
    );
  }, []);
  // 添付だけのメッセージを引用したときの文言。**リテラルで持たない**
  // （兄弟アプリが業種に合わせて差し替えるため。forkHostileTests.test.ts）
  const attachmentLabels = {
    image: t("trainerMessages.previewImage"),
    video: t("trainerMessages.previewVideo"),
  };

  // Mark messages as read when viewing
  useEffect(() => {
    markAsRead();
  }, [messages]);

  // Scroll to bottom on new messages
  //
  // ⚠️ 検索中は下へ飛ばさない。ヒット位置へジャンプした直後に最下部へ戻され、
  //    探しているものが**一瞬で画面から消える**（検索が使い物にならない）。
  useEffect(() => {
    if (search.active) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, search.active]);

  // キーボードの開閉でメッセージ欄の高さが変わる。位置を直さないと、
  // キーボードを出した瞬間に**直前まで読んでいた一番下の発言が隠れる**。
  useEffect(() => {
    if (search.active) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [keyboardInset, search.active]);

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

  /**
   * スタンプを送る。**1タップで送信まで行く**（LINE と同じ）。
   * 選んだあと「送信」を押させると、絵を選ぶ手軽さが消える。
   *
   * 本文にはスタンプの文字をそのまま入れる（`src/lib/stickers.ts` の `text`）。
   * 古いアプリでも文章として読め、通知の本文も空にならない。
   */
  const handleSendSticker = async (stickerId: string) => {
    const sticker = findSticker(stickerId);
    if (!sticker || !trainerId) return;
    setStickerOpen(false);
    try {
      await sendMessage(sticker.text, trainerId, null, sticker.id);
    } catch (e) {
      console.error("スタンプの送信に失敗:", e);
      toast.error(t("customerChat.sendFailed"));
    }
  };

  const handleUnsend = async (messageId: string) => {
    try {
      await unsendMessage(messageId);
    } catch (e) {
      // 24時間を過ぎている・自分の発言ではない等。DB 側が最終判断なので、
      // クライアントで出していても弾かれることがある。
      console.error("送信の取り消しに失敗:", e);
      toast.error(t("chat.unsendFailed"));
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

  // 送信先スタッフが解決できない場合（テナント未所属・所属が非active等）は、
  // 何も起きていないように見える空チャットではなく、明示的にエラーを表示する。
  if (!resolvingTrainer && !trainerId) {
    return (
      <div className="flex flex-col min-h-[60vh] items-center justify-center px-6 text-center gap-2 slide-up">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <p className="text-sm font-bold">{t("customerChat.noTrainerFound")}</p>
        <p className="text-xs text-muted-foreground">{t("customerChat.noTrainerFoundHelp")}</p>
      </div>
    );
  }

  return (
    /* 🔴 画面に貼り付ける（2026-09-01）。以前は h-[calc(100vh-8.5rem)] だったが、
       iOS の WKWebView では 100vh がキーボードで縮まないため、一番下にある入力欄が
       キーボードの裏に入り、打っている文字が見えなかった。上はアプリヘッダーの下、
       下は max(キーボード, ボトムナビ) に固定して、LINE と同じく入力欄を常に見せる。
       max-w-md mx-auto は CustomerView の本体幅に合わせるため（fixed で外れるので明示）。

       🔴 上下の逃がし幅は**実測値**（--app-header-h / --nav-h）。直書きの 5rem では
       システムバーぶんナビが高くなる Android の実機で、入力欄がナビの裏に
       潜り込んで押せなくなった（2026-09-01 に実機で発覚）。 */
    <div
      className="flex flex-col slide-up
        fixed left-0 right-0 z-30 w-full max-w-md mx-auto bg-background
        top-[var(--app-header-h,3.5rem)]
        bottom-[max(var(--kb,0px),var(--nav-h,6rem))]"
    >
      <KeyboardMetrics />
      <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
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
          <p className="font-bold text-sm flex-1">{trainerName}</p>
          <button
            type="button"
            onClick={() => search.setOpen((v) => !v)}
            aria-label={t("chat.search")}
            className="p-2 -mr-2 rounded-lg hover:bg-muted"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </div>

      {search.open && (
        <ConversationSearch
          query={search.query}
          onQueryChange={search.setQuery}
          total={search.hits.length}
          index={search.index}
          onStep={search.step}
          onClose={search.close}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-8">
            {t("customerChat.emptyPrompt")}
          </div>
        )}
        {messages.map((msg, i) => {
          const showDate = needsDateSeparator(
            msg.created_at,
            i > 0 ? messages[i - 1].created_at : null,
          );
          const isMe = msg.sender_id === user?.id;
          // スタッフが2人以上いるジムでは、誰から返ってきたかを出す。
          // 1人ジム（Salute 御所南など）では出さない（毎回同じ名前が並ぶだけ）。
          const staffName =
            !isMe && staff.ids.length > 1 ? staff.names.get(msg.sender_id) ?? null : null;
          // 引用は本文の先頭に文字列として入っている。地の文と分けて出す
          // （同じ見た目で出すと、引用した相手の発言が自分の発言として読まれる）。
          const { quote, body } = splitReplyQuote(msg.content);
          const isHit = search.currentId === msg.id;
          const unsent = isUnsent(msg);
          // 知らない id なら null。そのときは絵を出さず、本文（＝スタンプの文字）を
          // いつもの吹き出しで見せる。新しいスタンプを持つ端末から、まだ更新していない
          // 端末へ送られたときにここへ来る（落とさずに文字で伝わるのが狙い）。
          const sticker = unsent ? null : findSticker(msg.sticker_id);

          return (
            <div key={msg.id} ref={search.registerRef(msg.id)}>
              {showDate && <DateSeparator at={msg.created_at} />}
              <div className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                {staffName && (
                  <span className="text-[10px] text-muted-foreground mb-0.5 ml-1">{staffName}</span>
                )}
                <MessageActions
                  alignEnd={isMe}
                  onReact={
                    unsent ? undefined : (kind) => reactions.toggle(msg.id, kind, tenantId)
                  }
                  onUnsend={
                    canUnsend(msg, user?.id) ? () => handleUnsend(msg.id) : undefined
                  }
                  onReply={() =>
                    setInput((cur) =>
                      prependReply(
                        cur,
                        formatReplyQuote(
                          {
                            content: msg.content,
                            attachment_type: msg.attachment_type,
                            senderName: isMe ? null : staffName ?? trainerName,
                          },
                          attachmentLabels,
                        ),
                      ),
                    )
                  }
                >
                {sticker ? (
                  /* 🔴 スタンプは吹き出しに入れない。絵だけが宙に浮くのが「スタンプ」で、
                     吹き出しに入れると、ただの小さい添付写真に見える。 */
                  <div
                    className={`flex flex-col ${isMe ? "items-end" : "items-start"} ${
                      isHit ? "ring-2 ring-accent rounded-2xl" : ""
                    }`}
                  >
                    <MessageSticker sticker={sticker} />
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      {isMe && msg.read && <span>{t("common.messageRead")}</span>}
                      <span>{formatJST(msg.created_at, "HH:mm")}</span>
                    </p>
                  </div>
                ) : (
                <div
                  className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 transition-shadow ${
                    isMe
                      ? "accent-gradient text-accent-foreground rounded-br-md"
                      : "bg-card border border-border rounded-bl-md shadow-sm"
                  } ${isHit ? "ring-2 ring-accent" : ""}`}
                >
                  {unsent && <UnsentNotice />}
                  {!unsent && quote && <ReplyQuote text={quote} onAccent={isMe} />}
                  {!unsent && msg.attachment_type && (
                    <div className={body.trim() ? "mb-1.5" : ""}>
                      <MessageAttachment
                        type={msg.attachment_type}
                        url={msg.attachment_url}
                        onOpenImage={setLightboxUrl}
                      />
                    </div>
                  )}
                  {!unsent && body.trim() && (
                    <MessageText
                      text={body}
                      onAccent={isMe}
                      highlight={search.active ? search.query : undefined}
                    />
                  )}
                  <p
                    className={`text-[10px] mt-1 flex items-center gap-1.5 ${
                      isMe ? "justify-end text-accent-foreground/60" : "text-muted-foreground"
                    }`}
                  >
                    {/* 既読は自分が送った分にだけ出す。相手の吹き出しに出しても意味がない。
                        `read` は元から DB にあり、useMessages が UPDATE を購読するように
                        なって初めて画面に反映されるようになった。 */}
                    {isMe && !unsent && msg.read && <span>{t("common.messageRead")}</span>}
                    <span>{formatJST(msg.created_at, "HH:mm")}</span>
                  </p>
                </div>
                )}
                </MessageActions>
                {!unsent && (
                  <MessageReactions
                    reactions={reactions.byMessage.get(msg.id) ?? []}
                    currentUserId={user?.id}
                    onToggle={(kind) => reactions.toggle(msg.id, kind, tenantId)}
                    alignEnd={isMe}
                  />
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* スタンプ欄。🔴 外枠の**中**で開く（外枠の高さは触らない。
          触るとキーボードの計算が4回目の作り直しになる。StickerPicker の注記を読むこと） */}
      {stickerOpen && <StickerPicker onPick={handleSendSticker} disabled={!trainerId} />}

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
          <StickerPickerButton
            open={stickerOpen}
            onToggle={() => setStickerOpen((v) => !v)}
            disabled={!trainerId}
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
