// 共有: メール本文 HTML のエンコード保護（auth-email-hook / send-transactional-email 共通）。
//
// 目的:
//   送信経路（外部メール基盤）の固定幅な行折り返しが、マルチバイト文字や
//   HTML 数値文字参照の「途中」に改行を入れてしまい、本文が文字化けするのを防ぐ。
//   （例: パスワード再設定メールで「パスワード」が「パスワ???ード」と化ける事象）
//
// 対策（2段構え）:
//   1. 非 ASCII 文字を数値文字参照 (&#NNN;) に変換し、生 UTF-8 バイトが
//      折り返しで分割されないようにする（ASCII 化）。
//   2. 文字参照化すると本文 1 行が大きく伸び（漢字 1 文字 = &#NNNNN; の約 8 文字）、
//      その長い行が転送側の折り返し境界（多くは 76 桁）の途中で割れて
//      &#12540; のような参照が壊れる。これを防ぐため、テキスト中の「参照と参照の間」
//      にだけ安全な改行を入れ、各行を SOFT_WRAP_WIDTH 以下に保つ。
//      改行は HTML コメントで包むため、どのメールクライアントでも余分な空白として
//      描画されない（コメントは描画されず、文字参照の連続だけが残る）。
//   3. タグの内側（href の URL や style 属性など）では一切改行しない。
//      → リンクや属性値を壊さない。

// 折り返し幅。転送側の典型的なハード折り返し（76 桁前後）より十分小さくして、
// 転送側がマルチバイト参照の途中で改行を入れる余地を無くす。
const SOFT_WRAP_WIDTH = 60;

/**
 * 非 ASCII 文字を HTML 数値文字参照に変換し、さらに各行を安全な幅に折り返して、
 * 送信経路の行折り返しによる文字化けを防止する。
 *
 * - 折り返しは「文字参照と文字参照の間」かつ「タグの外側」でのみ行う。
 *   文字参照・タグ・URL の途中では絶対に改行しない。
 * - 挿入する改行は HTML コメント (<!--\n-->) で包むため、描画上は無（余分な空白も出ない）。
 */
export function escapeNonAsciiToEntities(html: string): string {
  let out = "";
  let lineLen = 0;
  let insideTag = false;

  for (const ch of html) {
    // タグ文脈を追跡（タグ内では折り返さない＝URL/属性を壊さない）。
    if (ch === "<") insideTag = true;

    // 既存の改行はそのまま。行長カウンタをリセット。
    if (ch === "\n") {
      out += "\n";
      lineLen = 0;
      continue;
    }

    const code = ch.codePointAt(0)!;
    const isNonAscii = code > 127;
    const token = isNonAscii ? `&#${code};` : ch;

    // 行が長くなってきたら、非 ASCII 参照の手前で安全に折り返す。
    // （タグ内では折らない。ASCII テキストの語中では折らない＝半角語の分断防止）
    if (
      isNonAscii &&
      !insideTag &&
      lineLen > 0 &&
      lineLen + token.length > SOFT_WRAP_WIDTH
    ) {
      out += "<!--\n-->";
      lineLen = 3; // 新しい物理行の先頭 "-->" の分
    }

    out += token;
    lineLen += token.length;

    if (ch === ">") insideTag = false;
  }

  return out;
}
