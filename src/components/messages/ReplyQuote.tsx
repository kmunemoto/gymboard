interface ReplyQuoteProps {
  text: string;
  /** 自分の吹き出しの中か。地の色に合わせる */
  onAccent?: boolean;
}

/**
 * 吹き出しの中に出す引用部分。
 *
 * ⚠️ 引用は**地の文と見分けがつく**必要がある。同じ見た目で出すと、
 *    引用した相手の発言が**自分の発言として読まれる**。
 *    左の縦線と薄い文字で、返信本文と切り離す。
 */
const ReplyQuote = ({ text, onAccent = false }: ReplyQuoteProps) => (
  <div
    className={`mb-1.5 border-l-2 pl-2 text-[11px] leading-snug whitespace-pre-wrap break-words ${
      onAccent ? "border-current/40 opacity-75" : "border-border text-muted-foreground"
    }`}
  >
    {text}
  </div>
);

export default ReplyQuote;
