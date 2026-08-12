/**
 * メッセージの引用返信。
 *
 * ## なぜ要るか（2026-08-12）
 *
 * ジムのチャットは**間が空く**。お客様が朝に3つ質問して、返せるのが夜、ということが
 * 普通に起きる。そのとき「はい、大丈夫です」とだけ返すと、**どれへの返事か分からない**。
 * LINE の引用返信と同じものを置く。
 *
 * ## 🔴 参照ではなく文字列で入れる
 *
 * `reply_to_id` を持たせるのが素直に見えるが、**送信取り消し（B3）と噛み合わない**。
 * 元のメッセージを取り消したあとに「削除されたメッセージ」という枠だけが残り、
 * しかも**取り消したはずの本文が引用の中に生き残る**（取り消しの意味が消える）。
 *
 * 予約の引用（`messageQuote.ts`）と同じく**ただの文字列**にする。
 * 引用した時点の抜粋が本文の一部として残るので、あとから元が消えても会話は読める。
 *
 * ⚠️ 裏を返すと「引用してしまったものは取り消せない」。誤爆対策としての取り消しは
 *    **引用される前に**間に合う必要がある。B3 の24時間はそのための猶予でもある。
 */

/** 引用に載せる本文の長さ。長いと吹き出しが引用で埋まる。 */
export const MAX_REPLY_EXCERPT = 40;

/** 引用の行頭につける記号。返信の本文と見分けるためのもの。 */
const QUOTE_MARK = "> ";

export interface ReplyTarget {
  content: string;
  attachment_type: "image" | "video" | null;
  /** 引用の頭に出す送信者名。取れなければ省略する */
  senderName?: string | null;
}

/**
 * 添付だけのときに出す文言。
 *
 * 🔴 **ここにリテラルを書かない。** 呼び出し元が `t("trainerMessages.previewImage")`
 *    などから渡す。ジムボードでは「[写真]」だが、兄弟アプリは業種に合わせて
 *    差し替える（`forkHostileTests.test.ts` が見張っている）。
 */
export interface AttachmentLabels {
  image: string;
  video: string;
}

/**
 * 引用に載せる1行。
 *
 * 添付だけのメッセージは本文が空。そのまま空文字にすると
 * **「> 」だけの行**が残って何を引用したのか分からないので、種別を文言にする。
 */
export function replyExcerpt(target: ReplyTarget, labels: AttachmentLabels): string {
  const oneLine = target.content.replace(/\s+/g, " ").trim();
  if (!oneLine) {
    if (target.attachment_type === "image") return labels.image;
    if (target.attachment_type === "video") return labels.video;
    return "";
  }
  return oneLine.length > MAX_REPLY_EXCERPT
    ? `${oneLine.slice(0, MAX_REPLY_EXCERPT)}…`
    : oneLine;
}

/**
 * 本文の先頭に置く引用ブロック。
 *
 * ```
 * > 田中さん: 明日の19時に変更できますか？
 * ```
 */
export function formatReplyQuote(target: ReplyTarget, labels: AttachmentLabels): string {
  const excerpt = replyExcerpt(target, labels);
  if (!excerpt) return "";
  const name = target.senderName?.trim();
  return name ? `${QUOTE_MARK}${name}: ${excerpt}` : `${QUOTE_MARK}${excerpt}`;
}

/**
 * 引用を入力欄に入れる。
 *
 * ⚠️ 書きかけを消さない。引用は**先頭**に置き、書いていた文はその下に残す。
 *    同じ引用を二重に入れない（連打しても増えない）。
 */
export function prependReply(current: string, quote: string): string {
  if (!quote) return current;
  if (current.includes(quote)) return current;
  const rest = current.replace(/^\s+/, "");
  return rest ? `${quote}\n${rest}` : `${quote}\n`;
}

/**
 * 表示のために、本文を「引用部分」と「返信部分」に分ける。
 *
 * 引用行をそのまま地の文として出すと、**引用が自分の発言に見える**。
 * 先頭の連続した `> ` 行だけを引用として扱う（本文の途中の `>` は触らない）。
 */
export function splitReplyQuote(content: string): { quote: string | null; body: string } {
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith(QUOTE_MARK)) i++;
  if (i === 0) return { quote: null, body: content };
  return {
    quote: lines.slice(0, i).map((l) => l.slice(QUOTE_MARK.length)).join("\n"),
    body: lines.slice(i).join("\n").replace(/^\n+/, ""),
  };
}
