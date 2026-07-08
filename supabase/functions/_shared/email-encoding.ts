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
// 24 バイト × QP 3 倍 + 折り返し先頭 "-->" (3 バイト) = 75 で 76 未満に収まる。
// 20 だと 6 字ちょうどの短い日本語（例:「京都市中京区」）でも折り返しが 1 回発生し、
// 挿入された <!--\n--> が Gmail iOS ダークモード等で豆腐化して見えることがあった。
const MAX_LINE_BYTES = 24;

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

    // タグ外の半角スペース／タブは QP のソフト改行境界として安全に折り返せるため、
    // ここで論理行の桁カウンタをリセットする。こうしないと pretty:true が挿入する
    // 各要素前のインデント（20 スペース前後）が桁を食いつぶし、直後の短い日本語
    // テキストの中で <!--\n--> が挿入され、Gmail iOS ダークモード等で豆腐化する。
    if (!insideTag && (ch === " " || ch === "\t")) {
      lineBytes = 0;
    }

    if (ch === ">") {
      insideTag = false;
      // タグを閉じた瞬間に桁カウンタをリセットする。
      // <p style="..."> のようなタグ内 ASCII が 60 バイト近く積み上がった状態から
      // 直後の日本語テキストに移ると、必ず先頭で <!--\n--> が挿入される。
      // 段落先頭に注入されたコメントも Gmail iOS ダークモード等で豆腐化することがあり、
      // テキスト冒頭に見苦しい記号が並ぶ原因になるため、タグの直後は新規行として扱う。
      lineBytes = 0;
    }
  }

  return out;
}

const MAX_ASCII_HTML_LINE_CHARS = 48;
const ENTITY_RE = /^&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);/;

function appendAsciiHtmlToken(out: string, token: string, lineChars: number) {
  if (lineChars > 0 && lineChars + token.length > MAX_ASCII_HTML_LINE_CHARS) {
    out += "<!--\n-->";
    lineChars = 3; // 新しい物理行の先頭 "-->" の分
  }

  out += token;
  lineChars += token.length;
  return { out, lineChars };
}

/**
 * HTML の表示テキストだけを ASCII 安全な数値文字参照へ変換する。
 *
 * 予約確認メールで「・」「▼」など一部記号が iOS Mail 上で U+FFFD に
 * 化けるケースが残っていたため、HTML パートはタグ/属性を壊さず、テキスト
 * ノードだけを ASCII 化する。見た目はメールクライアント側で通常の日本語に
 * デコードされるが、送信経路がどこで折り返しても UTF-8 バイト列は分断されない。
 */
export function makeEmailHtmlAsciiSafe(html: string): string {
  let out = "";
  let lineChars = 0;
  let insideTag = false;

  for (let i = 0; i < html.length; ) {
    const codePoint = html.codePointAt(i)!;
    const ch = String.fromCodePoint(codePoint);
    const width = ch.length;

    if (ch === "\n") {
      out += "\n";
      lineChars = 0;
      i += width;
      continue;
    }

    if (insideTag) {
      out += ch;
      lineChars += 1;
      if (ch === ">") {
        insideTag = false;
        // タグを抜けたらテキスト用の桁カウンタをリセットする。
        // こうしないと <p style="..."> のようなタグ内 ASCII が桁を食いつぶし、
        // 直後の短い日本語テキストの途中で <!--\n--> が挿入されてしまう。
        // Gmail iOS ダークモード等でそのコメントが豆腐化して見える事象を避ける。
        lineChars = 0;
      }
      i += width;
      continue;
    }

    if (ch === "<") {
      insideTag = true;
      out += ch;
      lineChars += 1;
      i += width;
      continue;
    }

    let token: string;
    if (ch === "&") {
      const entity = html.slice(i).match(ENTITY_RE)?.[0];
      if (entity) {
        token = entity;
        i += entity.length;
      } else {
        token = "&amp;";
        i += width;
      }
    } else if (codePoint > 0x7f) {
      token = `&#${codePoint};`;
      i += width;
    } else {
      token = ch;
      i += width;
    }

    const next = appendAsciiHtmlToken(out, token, lineChars);
    out = next.out;
    lineChars = next.lineChars;
  }

  return out;
}
