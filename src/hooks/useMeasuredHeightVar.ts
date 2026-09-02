import { useEffect, type RefObject } from "react";

/**
 * 要素の実測の高さを CSS 変数へ流し続ける。
 *
 * 🔴 なぜ実測するか（2026-09-01・実機で踏んだ）
 *
 * チャットを画面に貼り付けたとき、下端の逃がし幅を `4rem` と**直書き**していた。
 * 手元のブラウザ（`env(safe-area-inset-bottom)` が 0）ではナビが 58px で 6px 余り、
 * 通ってしまった。ところが **Android の実機はシステムバーのぶんナビが 106px になり、
 * 入力欄が 34px ぶんナビの裏に潜り込んで押せない・打てない**状態になった。
 *
 * ボトムナビの高さは
 *   ・端末のシステムバー（`env(safe-area-inset-bottom)`）
 *   ・利用者の文字サイズ設定
 *   ・ジムごとに違うタブの本数（お客様側は中央の丸ボタンで更に高い）
 * で変わる。**決め打ちできる数字ではない。**
 *
 * ヘッダーも同じ理由で実測する（`env(safe-area-inset-top)` を含んだ高さがそのまま要る）。
 *
 * 変数が未設定でも画面が壊れないよう、使う側は必ず既定値つきで参照すること
 *   例: 下端を `max(var(--kb,0px), var(--nav-h,6rem))` にする
 * 既定値は**大きめ**に倒す。足りないと入力欄が隠れて操作できなくなるが、
 * 余ってもナビとの間に少し隙間が空くだけで済む。
 */
export function useMeasuredHeightVar(
  ref: RefObject<HTMLElement | null>,
  varName: string,
): void {
  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el) return;

    const set = () => {
      // display:none の要素は 0 になる（PC 幅で md:hidden のナビなど）。
      // その場合は変数を消して、使う側の既定値に戻す。
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) root.style.setProperty(varName, `${h}px`);
      else root.style.removeProperty(varName);
    };
    set();

    const cleanup = () => root.style.removeProperty(varName);

    // jsdom や古いブラウザには ResizeObserver が無い。無くても初期値は入る。
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", set);
      return () => {
        window.removeEventListener("resize", set);
        cleanup();
      };
    }

    // 🔴 border-box を見る。既定の content-box では **padding の変化を拾えない**。
    //    ナビの高さは `paddingBottom: env(safe-area-inset-bottom)` で伸びるので、
    //    content-box のままだと画面回転・ジェスチャーナビ切替でインセットが
    //    変わっても変数が古いままになり、また入力欄がナビの裏へ入る。
    //    （この取りこぼしはブラウザでの再現中に見つけた）
    const ro = new ResizeObserver(set);
    ro.observe(el, { box: "border-box" });
    // 画面の回転や PC 幅への切り替えは要素の寸法が変わらないこともあるので、
    // ウィンドウ側も見る（md:hidden の切り替わりを拾う）。
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
      cleanup();
    };
  }, [ref, varName]);
}

/** ボトムナビの高さ。チャットの下端がこれを避ける。 */
export const NAV_HEIGHT_VAR = "--nav-h";
/** 画面上部の固定ヘッダーの高さ。チャットの上端がこれを避ける。 */
export const APP_HEADER_VAR = "--app-header-h";
