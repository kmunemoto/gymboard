import { useEffect, useState } from "react";
import { computeKeyboardInset } from "@/lib/keyboardInset";

/**
 * キーボードまわりの実測値を画面に出す「ものさし」。`?kb=1` を付けたときだけ出る。
 *
 * ## 🔴 なぜこれが要るか（2026-09-03）
 *
 * 「チャットの入力欄がキーボードに隠れる」を2回直して、2回とも iOS の実機で直っていなかった。
 * 理由ははっきりしていて、**この不具合はクラウドのセッションからは1度も再現できない**。
 * jsdom には `visualViewport` が無く、ネイティブも動かせない。こちらは数式を読んで
 * 推測するしかなく、実機を持っている人は「隠れている」以上の情報を返せない。
 * その往復が2回空振りした。
 *
 * だから**数字そのものを見せる**。実機で `?kb=1` を付けてチャットを開き、キーボードを
 * 出したところを1枚撮ってもらえば、どの仮説が正しいか一発で分かる:
 *
 * | 見えるもの | 意味 |
 * |---|---|
 * | `covered` が 0 のまま | ビジュアルビューポートが縮んでいない。式ではなく取り込み方の問題 |
 * | `covered` は出るが `off` も同じくらい大きい | iOS がページをずらしている。持ち上げ量の計算の問題 |
 * | `kb` は出ているのに隠れる | 計算は合っていて、当てている CSS（position/bottom）の問題 |
 *
 * 既定では**何も描かない**ので、お客様の画面に出ることはない。
 */
const KeyboardMetrics = () => {
  const [on] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("kb") === "1";
    } catch {
      return false;
    }
  });
  const [m, setM] = useState({ inner: 0, vh: 0, off: 0 });

  useEffect(() => {
    if (!on) return;
    const vv = window.visualViewport;
    const read = () =>
      setM({
        inner: Math.round(window.innerHeight),
        vh: Math.round(vv?.height ?? window.innerHeight),
        off: Math.round(vv?.offsetTop ?? 0),
      });
    read();
    if (!vv) return;
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, [on]);

  if (!on) return null;

  const covered = m.inner - m.vh;
  const kb = computeKeyboardInset({ innerHeight: m.inner, viewportHeight: m.vh, offsetTop: m.off });
  return (
    <div
      data-testid="keyboard-metrics"
      className="fixed top-0 left-0 z-[100] px-2 py-1 text-[10px] font-mono
        bg-foreground/80 text-background rounded-br pointer-events-none"
    >
      inner={m.inner} vh={m.vh} off={m.off} covered={covered} kb={kb}
    </div>
  );
};

export default KeyboardMetrics;
