// 共有: メール本文 HTML を送信経路の行折り返しで文字化けさせないための整形。
// （auth-email-hook / send-transactional-email 共通）
//
// 背景:
//   パスワード再設定メール等で本文の「パスワード」が「パスワ???ード」と化けていた。
//   本文の長い 1 行が送信経路の固定幅折り返し（多くは 76 桁/バイト）の途中で割れ、
//   マルチバイト文字（や以前の数値文字参照）が壊れていたのが原因。
//
// 方針（仮説に依存しない二重防御）:
//   1. 本文は「生の UTF-8」のまま送る（数値文字参照化＝ASCII 化はしない）。
//      標準的なメール基盤は非 ASCII を含む本文を base64 等のラップ安全な転送
//      エンコードで送るため、これだけで折り返しによる分割は起きない。
//      （ASCII 化すると逆に 7bit 扱いになり、長い行が折り返されて割れていた疑いが濃い）
//   2. その上で、テキスト中の「文字と文字の間（タグの外側）」にだけ無描画の改行を入れ、
//      各行の UTF-8 バイト長を MAX_LINE_BYTES 以下に保つ。これにより、仮に送信経路が
//      行単位の固定幅で折り返しても、マルチバイト文字の途中で割れない。
//   3. 改行は HTML コメント (<!--\n-->) で包むため、どのメールクライアントでも
//      余分な空白として描画されない（コメントは描画されず、文字の連続だけが残る）。
//   4. タグの内側（href の URL・style 属性など）では一切折り返さない（リンク/属性を壊さない）。

// 折り返し境界（多くは 76）より十分小さくして、送信経路が文字の途中で折る余地を無くす。
const MAX_LINE_BYTES = 48;

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * メール本文 HTML を、送信経路の行折り返しで文字化けしないよう整形する。
 * 生の UTF-8 を保ちつつ、各行の UTF-8 バイト長を安全な幅に抑える。
 * 折り返しは「文字と文字の間」かつ「タグの外側」でのみ行い、
 * 文字・タグ・URL の途中では絶対に改行しない。挿入する改行は HTML コメントで
 * 包むため描画上は無（余分な空白も出ない）。
 */
export function wrapEmailHtml(html: string): string {
  let out = "";
  let lineBytes = 0;
  let insideTag = false;

  for (const ch of html) {
    // タグ文脈を追跡（タグ内では折り返さない＝URL/属性を壊さない）。
    if (ch === "<") insideTag = true;

    // 既存の改行はそのまま。行長カウンタをリセット。
    if (ch === "\n") {
      out += "\n";
      lineBytes = 0;
      continue;
    }

    const code = ch.codePointAt(0)!;
    const bytes = utf8ByteLength(code);
    const isMultibyte = bytes > 1;

    // マルチバイト文字の手前で、行が長くなりすぎる前に安全に折り返す。
    // （タグ内では折らない。ASCII 語中では折らない＝半角語の分断防止）
    if (
      isMultibyte &&
      !insideTag &&
      lineBytes > 0 &&
      lineBytes + bytes > MAX_LINE_BYTES
    ) {
      out += "<!--\n-->";
      lineBytes = 3; // 新しい物理行の先頭 "-->" の分
    }

    out += ch; // 生の文字のまま（数値文字参照化しない）
    lineBytes += bytes;

    if (ch === ">") insideTag = false;
  }

  return out;
}
