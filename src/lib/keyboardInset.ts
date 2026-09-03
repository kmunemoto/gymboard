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
  // キーボードが覆っている高さ。レイアウトビューポートごと縮む環境
  // （Android の adjustResize）ではここが 0 になり、放っておいてもつじつまが合う。
  const covered = m.innerHeight - m.viewportHeight;

  // 🔴 「キーボードが出ているか」の足切りは **covered** に対して行う（2026-09-03）。
  //
  // 2026-09-01 の版は、下の offsetTop を引いた**あと**の値に足切りをかけていた。
  // iOS はキーボードを出すとき、フォーカスした入力欄を見せようとビジュアルビューポートを
  // ずらす（offsetTop > 0）。入力欄は画面のいちばん下にあるので、ずれる量はキーボードの
  // 高さに近くなる。すると引いたあとの値が MIN_KEYBOARD_PX を下回って足切りに落ち、
  // **持ち上げが丸ごと 0 になって入力欄がキーボードの裏へ戻っていた。**
  //
  // Android が直っていたのは、この式が効いていたからではない。WebView ごと縮むので
  // covered も offsetTop も 0 になり、**そもそもこの計算を通らなかった**だけ。
  // 「Android で直った」ことは iOS の式が正しい証拠にならなかった。
  if (!Number.isFinite(covered) || covered < MIN_KEYBOARD_PX) return 0;

  // position:fixed の要素は**レイアウトビューポート基準**に置かれる。iOS がビジュアル
  // ビューポートをずらしているぶんは持ち上げから引く（引かないと必要以上に浮く）。
  // ずれがキーボードの高さに達していれば持ち上げ 0 が正しい（レイアウトの下端が
  // そのまま見えている状態）。
  const lift = covered - Math.max(0, m.offsetTop);
  return Math.max(0, Math.round(lift));
};
