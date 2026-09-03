import type { Sticker } from "@/lib/stickers";

/**
 * 送られてきたスタンプ1枚。
 *
 * 🔴 **吹き出しに入れない。** LINE と同じく、絵だけが宙に浮いて見えるのが「スタンプ」。
 * 吹き出しの中に画像として置くと、ただの小さい添付写真になる。
 * 呼び出し側は、この部品を出すときは吹き出しの背景・枠・余白を付けないこと。
 *
 * 大きさは 128px 前後。これ以上小さいと絵に描いてある文字が読めず、
 * これ以上大きいと1枚で画面が埋まる。
 */
const MessageSticker = ({ sticker }: { sticker: Sticker }) => (
  <img
    src={sticker.src}
    // 絵に文字が描いてあるので、読み上げにはその文字をそのまま渡す
    alt={sticker.text}
    data-testid="message-sticker"
    className="w-32 h-32 object-contain select-none"
    draggable={false}
  />
);

export default MessageSticker;
