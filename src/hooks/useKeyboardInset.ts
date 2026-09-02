import { useEffect, useState } from "react";
import { computeKeyboardInset, KEYBOARD_INSET_VAR } from "@/lib/keyboardInset";

/**
 * キーボードの高さを CSS 変数 `--kb` に流し込み、その px 値を返す。
 *
 * 使う側は下端を `max(var(--kb,0px), var(--nav-h,…))` にする。キーボードが出ていなければ
 * ボトムナビの高さ、出ていればキーボードの高さが採用され、入力欄が常に見える位置に来る。
 * 🔴 ナビの高さは**直書きしない**。実測して `--nav-h` に流す（useMeasuredHeightVar.ts）。
 *    直書きの 4rem で Android の実機の入力欄がナビの裏に隠れた（2026-09-01）。
 *
 * visualViewport が無い環境（テストの jsdom、古いブラウザ）では 0 のまま何もしない。
 */
export const useKeyboardInset = (): number => {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (px: number) => {
      root.style.setProperty(KEYBOARD_INSET_VAR, `${px}px`);
      // 同じ値なら再描画しない（visualViewport の scroll は指1本の操作で何度も飛ぶ）
      setInset((prev) => (prev === px ? prev : px));
    };
    apply(0);

    const vv = window.visualViewport;
    if (!vv) return () => root.style.removeProperty(KEYBOARD_INSET_VAR);

    const update = () =>
      apply(
        computeKeyboardInset({
          innerHeight: window.innerHeight,
          viewportHeight: vv.height,
          offsetTop: vv.offsetTop,
        }),
      );

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty(KEYBOARD_INSET_VAR);
    };
  }, []);

  return inset;
};
