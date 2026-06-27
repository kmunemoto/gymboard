// パスワード再設定メールを「素のテンプレート文字列」で組み立てる。
//
// 背景: react-email の renderAsync（Deno のストリーミング描画）が、本文の
// 日本語マルチバイト文字を UTF-8 のチャンク境界で分割し、U+FFFD（置換文字）に
// 壊す事象が確認された（受信メールの生ソースで「ー」が =EF=BF=BD×3 になっていた。
// html 版・plain text 版の両方で発生＝描画段階の問題）。
//
// 対策: 再設定メールは React 描画・ストリーミングを一切経由せず、プレーンな
// テンプレート文字列で生成する。さらに HTML 版の表示テキストは数値文字参照
// （ASCII）にし、短い HTML コメント改行を挟む。これにより送信経路が UTF-8 の
// マルチバイト文字を途中で折り返す余地をなくす。confirmationUrl は ASCII のみ。

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const MAX_SAFE_HTML_LINE_CHARS = 48;

function escapeAsciiHtmlText(ch: string): string {
  switch (ch) {
    case "&":
      return "&amp;";
    case "<":
      return "&lt;";
    case ">":
      return "&gt;";
    case '"':
      return "&quot;";
    default:
      return ch;
  }
}

function encodeHtmlTextSafely(text: string): string {
  let out = "";
  let lineChars = 0;

  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    const encoded = codePoint > 0x7f ? `&#${codePoint};` : escapeAsciiHtmlText(ch);

    if (lineChars > 0 && lineChars + encoded.length > MAX_SAFE_HTML_LINE_CHARS) {
      out += "<!--\n-->";
      lineChars = 3; // 新しい物理行の先頭 "-->" の分
    }

    out += encoded;
    lineChars += encoded.length;
  }

  return out;
}

/** 再設定メールの HTML 本文（recovery.tsx と同じ見た目）。 */
export function renderRecoveryHtml(confirmationUrl: string): string {
  const url = escapeHtmlAttr(confirmationUrl);
  const title = encodeHtmlTextSafely("パスワードの再設定");
  const body = encodeHtmlTextSafely(
    "ジムボードのパスワード再設定リクエストを受け付けました。下のボタンから新しいパスワードを設定してください。",
  );
  const cta = encodeHtmlTextSafely("パスワードを再設定する");
  const footer = encodeHtmlTextSafely(
    "このメールにお心当たりがない場合は、破棄してください。パスワードは変更されません。",
  );

  return `<!DOCTYPE html>
<html lang="ja" dir="ltr">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
</head>
<body style="background-color:#ffffff;margin:0;padding:0;font-family:'Hiragino Sans','Yu Gothic',Arial,sans-serif">
<table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:0 auto;padding:20px 25px">
<tbody>
<tr>
<td>
<h1 style="font-size:22px;font-weight:bold;color:#000000;margin:0 0 20px">${title}</h1>
<p style="font-size:14px;line-height:1.7;color:#55575d;margin:0 0 25px">${body}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 25px">
<tbody>
<tr>
<td style="background-color:hsl(36, 40%, 42%);border-radius:12px;text-align:center">
<a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">${cta}</a>
</td>
</tr>
</tbody>
</table>
<p style="font-size:12px;line-height:1.7;color:#999999;margin:30px 0 0">${footer}</p>
</td>
</tr>
</tbody>
</table>
</body>
</html>`;
}

/** 再設定メールのプレーンテキスト本文。 */
export function renderRecoveryText(confirmationUrl: string): string {
  return [
    "パスワードの再設定",
    "",
    "ジムボードのパスワード再設定リクエストを受け付けました。下のボタンから新しいパスワードを設定してください。",
    "",
    "▼ パスワードを再設定する",
    confirmationUrl,
    "",
    "このメールにお心当たりがない場合は、破棄してください。パスワードは変更されません。",
  ].join("\n");
}
