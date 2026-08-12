/**
 * 本文中の URL をリンクにする。
 *
 * ## なぜ要るか（2026-08-12）
 *
 * 本文は `whitespace-pre-wrap` のただのテキストだった。フォーム解説の動画URL や
 * 決済ページのリンクを送っても**押せない**ので、お客様は手で選択してコピーするか、
 * 結局 LINE に貼り直すことになっていた。
 *
 * ## 🔴 HTML として描画しない
 *
 * `dangerouslySetInnerHTML` で `<a>` を差し込むのがいちばん短いが、
 * **本文はお客様が自由に入力できる文字列**なので、そこに HTML を通すと
 * そのままスクリプト実行の入り口になる。ここでは**文字列を分割して返すだけ**にし、
 * 描画側は React の要素として組む（React が自動でエスケープする）。
 *
 * ## 🔴 http/https 以外はリンクにしない
 *
 * `javascript:` はもちろん、`data:` も HTML を持てるので弾く。
 * リンクにしない文字列は**ただのテキストとして残す**（消してはいけない。
 * 送った本人の意図した文が黙って欠ける）。
 */

export type LinkSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

/**
 * URL らしきものを拾う。
 *
 * ⚠️ 末尾の句読点・閉じ括弧は URL に含めない。「詳しくは https://example.com/a 。」の
 *    「。」まで取り込むと、リンクが 404 になる。日本語の文中に貼られるので実際に起きる。
 */
const URL_RE = /https?:\/\/[^\s<>"'）】」』]+/gi;

/** URL の末尾から落とす文字。文の区切りとして書かれたもの。 */
const TRAILING = /[.,;:!?。、）)\]】」』>]+$/;

/**
 * `http` / `https` だけを許す。それ以外のスキームは**リンクにしない**。
 * 相対URLやプロトコル相対（`//evil.com`）も弾く。
 */
export function isSafeHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 本文を「ただの文字」と「リンク」に切り分ける。
 * リンクが1つも無ければ、全体が1つの text セグメントとして返る。
 */
export function linkify(text: string): LinkSegment[] {
  const out: LinkSegment[] = [];
  let cursor = 0;

  // 正規表現に g を付けているので lastIndex を持ち回る。使い回さないよう毎回作る。
  const re = new RegExp(URL_RE.source, "gi");
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    let candidate = m[0];
    const trailing = candidate.match(TRAILING)?.[0] ?? "";
    if (trailing) candidate = candidate.slice(0, -trailing.length);

    // 末尾を削った結果が空／安全でないなら、リンクにせず素通りさせる
    if (!candidate || !isSafeHttpUrl(candidate)) continue;

    const start = m.index;
    if (start > cursor) out.push({ type: "text", value: text.slice(cursor, start) });
    out.push({ type: "link", value: candidate, href: candidate });
    cursor = start + candidate.length;
  }

  if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
  return out;
}
