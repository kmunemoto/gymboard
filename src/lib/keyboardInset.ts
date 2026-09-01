/**
 * ソフトキーボードが画面の下からどれだけ覆っているか（px）を出す。
 *
 * 🔴 なぜ visualViewport を使うか（2026-09-01）
 * iOS の WKWebView では `100vh` も `window.innerHeight` も**キーボードが出ても縮まない**。
 * そのため `h-[calc(100vh-200px)]` のような高さ指定はキーボードが出た瞬間に破綻し、
 * 一番下に置いた入力欄がキーボードの裏へ入って、**自分が今何を打っているか見えなくなる**。
 *
 * Capacitor の keyboardWillShow が返す keyboardHeight を値として使う手もあるが、
 * プラットフォーム側が既に WebView ごと縮めている場合（Android の adjustResize 等）に
 * **二重に引いてしまう**。visualViewport は「実際に見えている領域」そのものなので、
 * 縮んだ環境では overlap が 0 になり、放っておいてもつじつまが合う。
 */

/**
 * これ未満は「キーボードは出ていない」とみなす。
 * モバイルブラウザのアドレスバーは伸縮するだけで数十px動くので、素の差分を信じない。
 */
export const MIN_KEYBOARD_PX = 80;

/** チャットの位置計算が読む CSS カスタムプロパティ名。 */
export const KEYBOARD_INSET_VAR = "--kb";

export type ViewportMetrics = {
  /** レイアウトビューポートの高さ（window.innerHeight） */
  innerHeight: number;
  /** 実際に見えている領域の高さ（visualViewport.height） */
  viewportHeight: number;
  /** 見えている領域の上端オフセット（visualViewport.offsetTop） */
  offsetTop: number;
};

export const computeKeyboardInset = (m: ViewportMetrics): number => {
  const overlap = m.innerHeight - (m.viewportHeight + m.offsetTop);
  if (!Number.isFinite(overlap) || overlap < MIN_KEYBOARD_PX) return 0;
  return Math.round(overlap);
};
