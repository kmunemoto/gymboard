// 認証メール6種を「素のテンプレート文字列」で組み立てる。
//
// ════════════════════════════════════════════════════════════════════════════
// なぜ React（react-email）を使わないのか
// ════════════════════════════════════════════════════════════════════════════
//
// **Deno のストリーミング HTML 描画が、日本語を UTF-8 のチャンク境界で分割して
// U+FFFD（置換文字）に壊す。**
//
// 引き金は `<Preview>`。目に見えないパディング文字を本文の前に大量に挿入するので、
// 本文が大きなバイトオフセットまで押し出され、最初の描画チャンクをまたぐ。
// そこにマルチバイト文字がかかると壊れる。
//
// ── 実際に2回起きている ──────────────────────────────────────
//
// 2026-06 ジムボード : 「パスワ???ード」（recovery）
// 2026-08 ピラボード : 「お心当たりがない」の**「当」が U+FFFD ×3**（signup）
//                      → **お客様に届いた**
//
// 1回目の対処が **`recovery` だけ**だったので、2回目が起きた。
// 種別ごとに逃がすと必ずこうなるので、**6種別すべてをここに統一する。**
//
// ── 「短いメールなら平気」は成立しない ──────────────────────
//
// 壊れるのは**文書の後ろにある文字ほど**起きやすい。`<Preview>` を外しても、
// 文面が伸びればまた境界に当たる。**条件次第で再発する対処は対処ではない。**
//
// ── この化けは検知できない ────────────────────────────────
//
// `email_send_log` のステータスは `sent` のまま。ログにも出ない。
// **気づける経路は受信トレイの実物だけ。** だから送る前に構造で防ぐ。
//
// ════════════════════════════════════════════════════════════════════════════
// 二重の防御
// ════════════════════════════════════════════════════════════════════════════
//
// 1. React・ストリーミング描画を一切通さない（この壊れ方の原因を断つ）
// 2. HTML の表示テキストを**数値文字参照（ASCII）**にする
//    → 送信経路の quoted-printable は非ASCIIを3倍に膨らませてから76バイトで折る。
//      その折り返しがマルチバイトの途中に来ても、ASCII なら壊れようがない。
//
// `recovery` は `recovery-plain.ts` に委譲している。
// **実機で検証済みのパスワード再設定メールを、1バイトも変えないため。**
//
// 見張り: `src/test/authEmailPlain.test.ts` / `src/test/recoveryEmail.test.ts`

import { renderRecoveryHtml, renderRecoveryText } from "./recovery-plain.ts";

export type AuthEmailType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "reauthentication";

export interface AuthEmailProps {
  siteName: string;
  siteUrl: string;
  recipient?: string;
  confirmationUrl: string;
  token?: string;
  oldEmail?: string;
  newEmail?: string;
}

// ---------------------------------------------------------------------------
// エンコード（recovery-plain.ts と同じ方針）
// ---------------------------------------------------------------------------

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const MAX_SAFE_HTML_LINE_CHARS = 48;

function escapeAsciiHtmlText(ch: string): string {
  switch (ch) {
    case "&": return "&amp;";
    case "<": return "&lt;";
    case ">": return "&gt;";
    case '"': return "&quot;";
    default: return ch;
  }
}

/**
 * 表示テキストを ASCII だけにする。
 * 非ASCIIは数値文字参照へ。長い行は表示に出ない HTML コメント改行で折る。
 */
function enc(text: string): string {
  let out = "";
  let lineChars = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const encoded = cp > 0x7f ? `&#${cp};` : escapeAsciiHtmlText(ch);
    if (lineChars > 0 && lineChars + encoded.length > MAX_SAFE_HTML_LINE_CHARS) {
      out += "<!--\n-->";
      lineChars = 3;
    }
    out += encoded;
    lineChars += encoded.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 文面の定義（ここが唯一の宣言。フォークはここを自分の言葉に差し替える）
// ---------------------------------------------------------------------------

/** 段落を構成する断片。href があればリンクになる */
interface Seg {
  text: string;
  href?: string;
  strong?: boolean;
}

interface AuthEmailContent {
  title: string;
  paragraphs: Seg[][];
  /** 大きく表示するコード（reauthentication のみ） */
  code?: string;
  cta?: { label: string; url: string };
  footer: string;
}

const FOOTER_DISCARD = "このメールにお心当たりがない場合は、破棄してください。";

function contentFor(type: AuthEmailType, p: AuthEmailProps): AuthEmailContent {
  const site: Seg = { text: p.siteName, href: p.siteUrl, strong: true };
  switch (type) {
    case "signup":
      return {
        title: "メールアドレスの確認",
        paragraphs: [
          [site, { text: "にご登録いただきありがとうございます。" }],
          [{ text: `下のボタンをクリックして、メールアドレス（${p.recipient ?? ""}）の確認を完了してください。` }],
        ],
        cta: { label: "メールアドレスを確認する", url: p.confirmationUrl },
        footer: FOOTER_DISCARD,
      };
    case "invite":
      return {
        title: "ご招待のお知らせ",
        paragraphs: [
          [site, { text: "へご招待されました。下のボタンから招待を承認し、アカウントを作成してください。" }],
        ],
        cta: { label: "招待を承認する", url: p.confirmationUrl },
        footer: FOOTER_DISCARD,
      };
    case "magiclink":
      return {
        title: "ログイン用リンク",
        paragraphs: [
          [{ text: `下のボタンをクリックして${p.siteName}にログインしてください。リンクは一定時間で無効になります。` }],
        ],
        cta: { label: "ログインする", url: p.confirmationUrl },
        footer: FOOTER_DISCARD,
      };
    case "email_change":
      return {
        title: "メールアドレス変更の確認",
        paragraphs: [
          [{ text: `${p.siteName}のメールアドレスを ${p.oldEmail ?? ""} から ${p.newEmail ?? ""} へ変更するリクエストを受け付けました。` }],
          [{ text: "下のボタンをクリックして変更を確定してください。" }],
        ],
        cta: { label: "メールアドレス変更を確定する", url: p.confirmationUrl },
        footer: "このメールにお心当たりがない場合は、速やかにアカウントの安全を確認してください。",
      };
    case "reauthentication":
      return {
        title: "認証コード",
        paragraphs: [[{ text: "本人確認のため、以下のコードを入力してください。" }]],
        code: p.token ?? "",
        footer: "このコードは一定時間で無効になります。お心当たりがない場合は、破棄してください。",
      };
    case "recovery":
      // 呼ばれない（renderAuthHtml が先に委譲する）。網羅性のため置く。
      return { title: "", paragraphs: [], footer: "" };
  }
}

// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

function renderSegs(segs: Seg[]): string {
  return segs
    .map((s) => {
      const inner = s.strong ? `<strong>${enc(s.text)}</strong>` : enc(s.text);
      return s.href
        ? `<a href="${escapeHtmlAttr(s.href)}" style="color:hsl(36, 40%, 42%);text-decoration:underline">${inner}</a>`
        : inner;
    })
    .join("");
}

/** 認証メールの HTML 本文。**React を通さないので化けようがない。** */
export function renderAuthHtml(type: AuthEmailType, props: AuthEmailProps): string {
  if (type === "recovery") return renderRecoveryHtml(props.confirmationUrl);

  const c = contentFor(type, props);
  const body = c.paragraphs
    .map((segs) => `<p style="font-size:14px;line-height:1.7;color:#55575d;margin:0 0 25px">${renderSegs(segs)}</p>`)
    .join("\n");

  const code = c.code
    ? `<p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#000000;margin:0 0 25px;text-align:center">${enc(c.code)}</p>`
    : "";

  const cta = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 25px">
<tbody>
<tr>
<td style="background-color:hsl(36, 40%, 42%);border-radius:12px;text-align:center">
<a href="${escapeHtmlAttr(c.cta.url)}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">${enc(c.cta.label)}</a>
</td>
</tr>
</tbody>
</table>`
    : "";

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
<h1 style="font-size:22px;font-weight:bold;color:#000000;margin:0 0 20px">${enc(c.title)}</h1>
${body}
${code}${cta}
<p style="font-size:12px;line-height:1.7;color:#999999;margin:30px 0 0">${enc(c.footer)}</p>
</td>
</tr>
</tbody>
</table>
</body>
</html>`;
}

/** 認証メールのプレーンテキスト本文。**こちらも React を通さない。** */
export function renderAuthText(type: AuthEmailType, props: AuthEmailProps): string {
  if (type === "recovery") return renderRecoveryText(props.confirmationUrl);

  const c = contentFor(type, props);
  const lines: string[] = [c.title, ""];
  for (const segs of c.paragraphs) {
    lines.push(segs.map((s) => s.text).join(""), "");
  }
  if (c.code) lines.push(c.code, "");
  if (c.cta) lines.push(`▼ ${c.cta.label}`, c.cta.url, "");
  lines.push(c.footer);
  return lines.join("\n");
}
