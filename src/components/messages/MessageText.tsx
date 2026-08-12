import { Fragment } from "react";
import { linkify } from "@/lib/linkify";

interface MessageTextProps {
  text: string;
  /** 自分の吹き出しか。リンクの色を地の色に合わせるために使う */
  onAccent?: boolean;
}

/**
 * 吹き出しの本文。URL だけリンクにする。
 *
 * 🔴 **HTML として描画しない。** 本文はお客様が自由に入力できる文字列なので、
 *    `dangerouslySetInnerHTML` を使うとそこがスクリプト実行の入り口になる。
 *    `linkify` は**文字列を分割して返すだけ**で、ここで React 要素として組む
 *    （React が自動でエスケープする）。
 */
const MessageText = ({ text, onAccent = false }: MessageTextProps) => (
  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
    {linkify(text).map((seg, i) =>
      seg.type === "link" ? (
        <a
          key={i}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          // 吹き出しを押したときの操作（返信メニュー等）と競合させない
          onClick={(e) => e.stopPropagation()}
          className={`underline underline-offset-2 break-all ${
            onAccent ? "opacity-90 hover:opacity-100" : "text-accent hover:opacity-80"
          }`}
        >
          {seg.value}
        </a>
      ) : (
        <Fragment key={i}>{seg.value}</Fragment>
      ),
    )}
  </p>
);

export default MessageText;
