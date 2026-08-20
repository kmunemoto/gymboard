// 共有: メール本文 HTML を送信経路の行折り返しで文字化けさせないための整形。
// （auth-email-hook / send-transactional-email 共通）
//
// ## 何が起きていたか（第1章・2026-07）
//
// パスワード再設定メールの「パスワード」が「パスワ???ード」と化けていた。
// 本文の長い1行が送信経路の固定幅折り返し（quoted-printable の76桁）の途中で
// マルチバイト文字を割っていた。見出し・ボタンは短い行のため無事だった。
//
// ## 🔴 その対策自体が第2の不具合になった（2026-08-18）
//
// 対策として「長い行を HTML コメント `<!--\n-->` で折る」方式にしたが、
// **このコメントが一部のメールクライアントで可視化される。**
//
//   予約確認メール: 「アプリからキ??ンセル・変更が可能です。」
//   （「ャ」の両側に入った `<!--\n-->` が ?? として描画された）
//
// 当時から「Gmail iOS ダークモード等で豆腐化して見えることがあった」と分かっていて、
// 折り返し幅を 20→24 バイトに広げて**頻度を下げただけ**だった。根治していなかった。
//
// ## いまの方針: 折り返しをやめる
//
// **表示テキストを数値文字参照にすれば、本文は純 ASCII になる。**
// quoted-printable は ASCII をそのまま通し、必要ならソフト改行 `=\n` を入れるが、
// **これは受信側で完全に元へ戻る**（`&#125=\n15;` は `&#12515;` に復元される）。
// つまり ASCII 化した時点で、こちらが行を折る必要は無い。
//
// 唯一やるのは「**元からある空白を改行に置き換える**」ことだけ。
// HTML では空白も改行も同じ空白として畳まれるので、見た目は一切変わらない。
// **新しい文字を本文に挿入しない**のが今回の要点。
//
// > 以前あった `wrapEmailHtml`（生 UTF-8 のまま行を折る関数）は削除した。
// > 呼び出し元は2つとも ASCII 化を通るようになったので不要で、
// > 残しておくと「コメントを挿入する方式」が再び使われてしまう。

/**
 * 元からある空白を改行に替えてよい桁数の目安。
 * 純 ASCII なので QP のソフト改行に任せても壊れないが、
 * 行が極端に長いと一部の MTA が扱いを誤るため、余裕があるところでは折っておく。
 */
const SOFT_WRAP_AT = 72;

const ENTITY_RE = /^&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);/;

/**
 * HTML の表示テキストだけを ASCII 安全な数値文字参照へ変換する。
 *
 * タグ・属性（href の URL 等）は一切変えない。テキストノードだけを ASCII 化するので、
 * 送信経路がどこで折り返してもマルチバイトが分断されない。
 * 見た目はメールクライアント側で通常の日本語にデコードされる。
 *
 * **本文に新しい文字を挿入しない。** 改行するのは「元から空白だった位置」だけ
 * （HTML では空白と改行は等価なので描画に影響しない）。
 * 既に `&#...;` になっている入力に対しては何もしない（冪等）。
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
        // タグ内の ASCII（style 属性など）で桁を食いつぶさないため。
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

    // 🔴 元からある空白だけを改行に替えてよい。
    //    ここで新しい文字（HTML コメント等）を入れると、メールクライアントに
    //    よっては可視化される（2026-08-18 の「キ??ンセル」）。
    if ((ch === " " || ch === "\t") && lineChars >= SOFT_WRAP_AT) {
      out += "\n";
      lineChars = 0;
      i += width;
      continue;
    }

    let token: string;
    if (ch === "&") {
      const entity = html.slice(i).match(ENTITY_RE)?.[0];
      if (entity) {
        // 既に実体参照ならそのまま通す（二重エンコードしない＝冪等）
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

    out += token;
    lineChars += token.length;
  }

  return out;
}
