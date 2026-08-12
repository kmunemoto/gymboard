import { Fragment } from "react";
import { linkify } from "@/lib/linkify";
import { highlightParts } from "@/lib/messageSearch";

interface MessageTextProps {
  text: string;
  /** 自分の吹き出しか。リンクの色を地の色に合わせるために使う */
  onAccent?: boolean;
  /** 検索語。渡すと一致部分を強調する */
  highlight?: string;
}

/** 地の文。検索語があれば一致部分だけ強調する。 */
const Plain = ({ value, highlight }: { value: string; highlight?: string }) => {
  if (!highlight?.trim()) return <>{value}</>;
  return (
    <>
      {highlightParts(value, highlight).map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-yellow-300/70 text-foreground rounded-sm px-0.5">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
};

/**
 * 吹き出しの本文。URL だけリンクにし、検索中は一致部分を強調する。
 *
 * 🔴 **HTML として描画しない。** 本文はお客様が自由に入力できる文字列なので、
 *    `dangerouslySetInnerHTML` を使うとそこがスクリプト実行の入り口になる。
 *    `linkify` / `highlightParts` は**文字列を分割して返すだけ**で、
 *    ここで React 要素として組む（React が自動でエスケープする）。
 *
 * ⚠️ 強調は**地の文にだけ**当てる。リンクの中を切り刻むと href が壊れる。
 */
const MessageText = ({ text, onAccent = false, highlight }: MessageTextProps) => (
  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
    {linkify(text).map((seg, i) =>
      seg.type === "link" ? (
        <a
          key={i}
          href={seg.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          // 吹き出しを押したときの操作（長押しメニュー等）と競合させない
          onClick={(e) => e.stopPropagation()}
          className={`underline underline-offset-2 break-all ${
            onAccent ? "opacity-90 hover:opacity-100" : "text-accent hover:opacity-80"
          }`}
        >
          {seg.value}
        </a>
      ) : (
        <Fragment key={i}>
          <Plain value={seg.value} highlight={highlight} />
        </Fragment>
      ),
    )}
  </p>
);

export default MessageText;
