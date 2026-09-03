import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, Send, ArrowLeft, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMessages, useUnreadBySender } from "@/hooks/useMessages";
import { useAttachmentPicker } from "@/hooks/useAttachmentPicker";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { useStaffDirectory } from "@/hooks/useStaffDirectory";
import MessageAttachment from "@/components/messages/MessageAttachment";
import MessageText from "@/components/messages/MessageText";
import DateSeparator from "@/components/messages/DateSeparator";
import ImageLightbox from "@/components/messages/ImageLightbox";
import MessageActions from "@/components/messages/MessageActions";
import ReplyQuote from "@/components/messages/ReplyQuote";
import UnsentNotice from "@/components/messages/UnsentNotice";
import MessageReactions from "@/components/messages/MessageReactions";
import ConversationSearch from "@/components/messages/ConversationSearch";
import { AttachmentButton, AttachmentPreview } from "@/components/messages/AttachmentComposer";
import MessageTemplateChips from "@/components/trainer/MessageTemplateChips";
import MessageTemplateDialog from "@/components/trainer/MessageTemplateDialog";
import { appendTemplate, replaceTemplateVars } from "@/lib/messageTemplate";
import BookingQuoteChips from "@/components/messages/BookingQuoteChips";
import { useQuotableBookings } from "@/hooks/useQuotableBookings";
import { prependQuote } from "@/lib/messageQuote";
import { useConversationSearch } from "@/hooks/useConversationSearch";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import KeyboardMetrics from "@/components/KeyboardMetrics";
import { formatReplyQuote, prependReply, splitReplyQuote } from "@/lib/messageReply";
import { canUnsend, isUnsent } from "@/lib/messageUnsend";
import { useMessageReactions } from "@/hooks/useMessageReactions";
import { needsDateSeparator, dayKeyJST } from "@/lib/chatDate";
import { sortConversations, type LastMessageInfo } from "@/lib/conversationOrder";
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
  unsent_at: string | null;
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
  const [lastMessages, setLastMessages] = useState<Record<string, LastMessageInfo>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // キーボードの高さを --kb へ流す。チャットの bottom がこれを見て持ち上がる。
  const keyboardInset = useKeyboardInset();
  // 共有受信箱: 別のスタッフ宛ての未読も自分の一覧に出す
  const staff = useStaffDirectory();
  const staffKey = staff.ids.join(",");
  const { counts: unreadCounts } = useUnreadBySender(staff.ids);

  const { messages, sendMessage, markAsRead, unsendMessage } = useMessages(selectedCustomerId, {
    selfIds: staff.ids,
  });
  const attachment = useAttachmentPicker(user?.id);
  const templateStore = useMessageTemplates();
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const { bookings: quotableBookings } = useQuotableBookings(selectedCustomerId);
  const search = useConversationSearch(messages);
  const reactions = useMessageReactions(messages.map((m) => m.id));
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
  //
  // ⚠️ 引くのは**スタッフ全員が関わる行**（共有受信箱）。自分の user_id だけで引くと、
  //    別のスタッフが担当している会話のプレビューが**空のまま**になり、
  //    一覧では「メッセージなし」に見える。未読数は staff.ids で数えているので、
  //    「バッジは付いているのに本文が出ない」というちぐはぐな状態になっていた。
  const fetchLastMessages = useCallback(async () => {
    if (!user || customers.length === 0) return;
    const sideIds = [...new Set([user.id, ...(staffKey ? staffKey.split(",") : [])])];
    const inList = `(${sideIds.join(",")})`;
    const { data } = await supabase
      .from("messages")
      .select("sender_id, receiver_id, content, attachment_type, created_at, unsent_at")
      .or(`sender_id.in.${inList},receiver_id.in.${inList}`)
      .order("created_at", { ascending: false })
      .limit(LAST_MESSAGE_SCAN_LIMIT);

    const map: Record<string, LastMessageInfo> = {};
    for (const row of (data ?? []) as MessageRow[]) {
      // 相手はスタッフ側でないほう。共有受信箱ではスタッフ同士の行も混ざりうるので、
      // 両側ともスタッフなら会話一覧の対象ではない。
      const senderIsUs = sideIds.includes(row.sender_id);
      const receiverIsUs = sideIds.includes(row.receiver_id);
      if (senderIsUs === receiverIsUs) continue;
      const other = senderIsUs ? row.receiver_id : row.sender_id;
      // 新しい順に見ているので、最初に現れたものがその相手の最終メッセージ
      if (map[other]) continue;
      // 添付だけのメッセージは本文が空。プレビューが空欄になると
      //「メッセージなし」と見分けがつかないので、種別を文言にする。
      // 取り消し済みは本文も添付も無い。空欄のままだと「メッセージなし」と
      // 見分けがつかないので、取り消された旨を出す。
      const text = row.unsent_at
        ? t("chat.unsentNotice")
        : row.content.trim()
          ? row.content
          : row.attachment_type === "video"
            ? t("trainerMessages.previewVideo")
            : row.attachment_type === "image"
              ? t("trainerMessages.previewImage")
              : row.content;
      map[other] = {
        content: text,
        // 一覧の時刻は「今日なら時刻、それより前は日付」。LINE と同じ読み方。
        time:
          dayKeyJST(row.created_at) === dayKeyJST(new Date())
            ? formatJST(row.created_at, "HH:mm")
            : formatJST(row.created_at, "M/d"),
        at: row.created_at,
      };
    }
    setLastMessages(map);
    // staff.ids は毎レンダー新しい配列になりうるので、キーにして安定させる
  }, [user, customers, staffKey, t]);

  useEffect(() => {
    fetchLastMessages();
  }, [fetchLastMessages]);

  // Mark as read when selecting conversation
  useEffect(() => {
    if (selectedCustomerId) markAsRead();
  }, [selectedCustomerId, messages]);

  // Scroll to bottom
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

  const handleUnsend = async (messageId: string) => {
    try {
      await unsendMessage(messageId);
    } catch (e) {
      // 24時間を過ぎている等。DB 側が最終判断なので、出していても弾かれることがある。
      console.error("送信の取り消しに失敗:", e);
      toast.error(t("chat.unsendFailed"));
    }
  };

  const selected = customers.find((c) => c.user_id === selectedCustomerId);

  // 定型文を入力欄に入れる。
  // ⚠️ 上書きしない。書きかけの文があれば末尾に足す（書いたものを消さない）。
  //    {{name}} はここで相手の表示名に置き換える（名前が無ければ敬称ごと落ちる）。
  const applyTemplate = (body: string) => {
    const filled = replaceTemplateVars(body, { name: selected?.display_name ?? null });
    setNewMsg((current) => appendTemplate(current, filled));
  };

  // 🔴 並びは「最後にやり取りした順」。以前は未読優先で、**既読にした瞬間に
  //    その会話が一覧の下へ飛んでいく**（返信しようとして探すことになる）状態だった。
  //    未読は新着なので時刻順にすれば自然に上に来る（バッジでも分かる）。
  const sortedCustomers = sortConversations(customers, lastMessages);

  return (
    <div className="pb-24 md:pb-0">
      <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
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
          /* 🔴 スマホでは画面に貼り付ける（2026-09-01）。
             以前は h-[calc(100vh-200px)] だったが、iOS の WKWebView では 100vh が
             キーボードで縮まないため、カードの一番下にある入力欄がキーボードの裏に
             入り、打っている文字が見えなかった。上はアプリヘッダーの下、下は
             max(キーボード, ボトムナビ) に固定して、LINE と同じく入力欄を常に見せる。

             🔴 上下の逃がし幅は**実測値**（--app-header-h / --nav-h）を使う。
             最初は 4rem と直書きしていて、safe-area が 0 の手元のブラウザでは
             6px 余って通ったが、**Android の実機ではシステムバーぶんナビが 106px に
             なり、入力欄が 34px 潜り込んで押せない・打てない**状態になった。
             既定値は大きめに倒す（足りないと操作不能、余っても隙間が空くだけ）。 */
          <Card
            className="flex flex-col overflow-hidden
              fixed left-0 right-0 z-30 rounded-none border-x-0 border-b-0
              top-[var(--app-header-h,3.5rem)]
              bottom-[max(var(--kb,0px),var(--nav-h,6rem))]
              md:static md:z-auto md:rounded-lg md:border md:top-auto md:bottom-auto md:h-auto"
          >
            <KeyboardMetrics />
            {/* Chat header */}
            <div className="p-3 sm:p-4 border-b border-border flex items-center gap-3">
              <button onClick={() => setSelectedCustomerId(null)} className="md:hidden text-muted-foreground p-1">
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="w-8 h-8 rounded-lg gym-gradient flex items-center justify-center text-primary-foreground font-bold text-xs">
                {selected?.avatar_initial}
              </div>
              <p className="font-bold text-sm flex-1 truncate">
                {selected?.display_name || t("common.customer")}
              </p>
              <button
                type="button"
                onClick={() => search.setOpen((v) => !v)}
                aria-label={t("chat.search")}
                className="p-2 -mr-1 rounded-lg hover:bg-muted shrink-0"
              >
                <Search className="w-4 h-4" />
              </button>
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
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground text-sm mt-8">
                  {t("trainerMessages.noHistory")}
                </div>
              )}
              {messages.map((msg, i) => {
                // 共有受信箱なので「ジム側の吹き出し」は自分とは限らない。
                // 他のスタッフが返した分も右側に出し、誰が返したかを上に添える。
                const isOurSide = msg.sender_id !== selectedCustomerId;
                const isTrainer = isOurSide;
                const otherStaffName =
                  isOurSide && msg.sender_id !== user?.id
                    ? staff.names.get(msg.sender_id) ?? t("sharedInbox.otherStaff")
                    : null;
                const showDate = needsDateSeparator(
                  msg.created_at,
                  i > 0 ? messages[i - 1].created_at : null,
                );
                // 引用は本文の先頭に文字列として入っている。地の文と分けて出す。
                const { quote, body } = splitReplyQuote(msg.content);
                const isHit = search.currentId === msg.id;
                const unsent = isUnsent(msg);
                return (
                  <div key={msg.id} ref={search.registerRef(msg.id)}>
                    {showDate && <DateSeparator at={msg.created_at} />}
                    <div className={`flex flex-col ${isTrainer ? "items-end" : "items-start"}`}>
                      {otherStaffName && (
                        <span className="text-[10px] text-muted-foreground mb-0.5 mr-1">
                          {otherStaffName}
                        </span>
                      )}
                      <MessageActions
                        alignEnd={isTrainer}
                        onReact={
                          unsent ? undefined : (kind) => reactions.toggle(msg.id, kind, tenantId)
                        }
                        onUnsend={
                          canUnsend(msg, user?.id) ? () => handleUnsend(msg.id) : undefined
                        }
                        onReply={() =>
                          setNewMsg((cur) =>
                            prependReply(
                              cur,
                              formatReplyQuote(
                                {
                                  content: msg.content,
                                  attachment_type: msg.attachment_type,
                                  senderName: isTrainer
                                    ? otherStaffName
                                    : selected?.display_name ?? null,
                                },
                                attachmentLabels,
                              ),
                            ),
                          )
                        }
                      >
                      <div
                        className={`max-w-[80%] sm:max-w-[75%] rounded-2xl px-3 sm:px-4 py-2 sm:py-2.5 transition-shadow ${
                          isTrainer
                            ? "accent-gradient text-accent-foreground rounded-br-md"
                            : "bg-muted rounded-bl-md"
                        } ${isHit ? "ring-2 ring-accent" : ""}`}
                      >
                        {unsent && <UnsentNotice />}
                        {!unsent && quote && <ReplyQuote text={quote} onAccent={isTrainer} />}
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
                            onAccent={isTrainer}
                            highlight={search.active ? search.query : undefined}
                          />
                        )}
                        <p
                          className={`text-[10px] mt-1 flex items-center gap-1.5 ${
                            isTrainer ? "justify-end opacity-70" : "text-muted-foreground"
                          }`}
                        >
                          {/* 既読は自分（ジム側）が送った分にだけ出す */}
                          {isTrainer && !unsent && msg.read && (
                            <span>{t("common.messageRead")}</span>
                          )}
                          {/* 日付は区切りが持つので、吹き出しには時刻だけ */}
                          <span>{formatJST(msg.created_at, "HH:mm")}</span>
                        </p>
                      </div>
                      </MessageActions>
                      {!unsent && (
                        <MessageReactions
                          reactions={reactions.byMessage.get(msg.id) ?? []}
                          currentUserId={user?.id}
                          onToggle={(kind) => reactions.toggle(msg.id, kind, tenantId)}
                          alignEnd={isTrainer}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-2 sm:p-3 border-t border-border">
              {/* 予約の引用。「明日の予約の件ですが」を文脈付きで言えるようにする */}
              <BookingQuoteChips
                bookings={quotableBookings}
                onQuote={(q) => setNewMsg((cur) => prependQuote(cur, q))}
              />
              {/* 定型文。離脱アラートの「声かけ」から飛んできたときも、ここから1タップで出せる */}
              <MessageTemplateChips
                templates={templateStore.templates}
                onPick={(tpl) => applyTemplate(tpl.body)}
                onManage={() => setTemplateDialogOpen(true)}
              />
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

      <MessageTemplateDialog
        open={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        store={templateStore}
      />
    </div>
  );
};

export default TrainerMessages;
