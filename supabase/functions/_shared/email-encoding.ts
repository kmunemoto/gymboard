// 共有: メール本文 HTML を送信経路の行折り返しで文字化けさせないための整形。
// （auth-email-hook / send-transactional-email 共通）
//
// 背景:
//   パスワード再設定メール等で本文の「パスワード」が「パスワ???ード」と化けていた。
//   本文の長い 1 行が送信経路の固定幅折り返し（多くは 76）の途中でマルチバイト文字を
//   割っていたのが原因。見出し・ボタンは短い行のため無事だった。
//
// 重要な実測（消去法）:
//   - base64 送信なら長い行でも安全 → だが化ける → base64 ではない。
//   - 8bit で「76バイト」折り返しなら 1 行 48 バイトに抑えれば安全 → だが化ける → これも違う。
//   - 残るは quoted-printable (QP)。QP は非 ASCII の各バイトを =XX（3 倍）に展開してから
//     76 桁で折り返す。つまり「生 48 バイト/行」は QP 後に約 144 文字となり、再び 76 桁で
//     折り返されてマルチバイトの途中で割れていた。これが全ての辻褄に合う。
//
// 方針（仮説に依存しない二重防御）:
//   1. 本文は「生の UTF-8」のまま送る（数値文字参照化＝ASCII 化はしない）。base64 経路でも
//      そのまま安全で、生 UTF-8 はラップ安全な base64 を選ばせやすい。
//   2. その上で、各行を「QP 展開を見込んで」十分短く保つ。1 文字最大 3 バイト→QP 9 文字なので、
//      行の生バイト長を MAX_LINE_BYTES(=20) 以下にすれば QP 後も約 60 文字 + 余白で 76 未満に収まり、
//      QP/8bit のどの折り返しでもマルチバイトの途中で割れない。
//   3. 折り返しはテキスト中の「文字と文字の間（タグの外側）」でのみ行い、文字・タグ・URL の
//      途中では絶対に改行しない。挿入する改行は HTML コメント (<!--\n-->) で包むため、
//      どのメールクライアントでも余分な空白として描画されない。

// 折り返し境界（76）を QP 展開後も超えないよう、生バイト長で十分小さく刻む。
// （1 文字 = 最大 3 バイト → QP 9 文字。20 バイト ≒ QP 60 文字 + 余白 < 76）
const MAX_LINE_BYTES = 20;

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * メール本文 HTML を、送信経路の行折り返し（特に quoted-printable）で文字化けしないよう整形する。
 * 生の UTF-8 を保ちつつ、各行の生バイト長を MAX_LINE_BYTES 以下に抑える
 * （QP で 3 倍に展開されても 76 を超えないようにするため）。
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
    // （タグ内では折らない。ASCII 語中では折らない＝半角語・URL の分断防止）
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
