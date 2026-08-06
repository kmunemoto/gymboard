import { describe, it, expect } from "vitest";
import { makeEmailHtmlAsciiSafe, wrapEmailHtml } from "../../supabase/functions/_shared/email-encoding";
import { readFileSync } from "node:fs";
import { BRAND } from "@/lib/brand";

// パスワード再設定メール本文（recovery.tsx の本文と同一）。
// 送信経路の固定幅折り返しで「パスワード」が「パスワ???ード」と化けていた回帰対象。
// 製品名は brand.ts から引く（recoveryEmail.test.ts と同じ理由）。
const RECOVERY_BODY =
  `${BRAND.ja}のパスワード再設定リクエストを受け付けました。下のボタンから新しいパスワードを設定してください。`;

const encoder = new TextEncoder();

// quoted-printable 後の行の長さ（=XX 展開を考慮）。これが 76 を超えると
// 送信経路が QP ソフト改行を挿入し、マルチバイトの途中で割れて文字化けする。
function qpLineLength(line: string): number {
  let n = 0;
  for (const b of encoder.encode(line)) {
    n += b >= 0x20 && b <= 0x7e && b !== 0x3d ? 1 : 3; // 印字ASCII(除く'=')は1、その他は=XXで3
  }
  return n;
}

// メールクライアントの描画を模す: HTMLコメントは無描画。本文は生UTF-8のまま。
const renderToText = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");

describe("wrapEmailHtml（メール文字化け対策・QP対応版）", () => {
  it("本文は生UTF-8のまま保持される（数値文字参照化しない）", () => {
    const out = wrapEmailHtml(RECOVERY_BODY);
    expect(out).not.toContain("&#");
    expect(renderToText(out)).toBe(RECOVERY_BODY);
  });

  it("各行は quoted-printable 展開後も76以下（QPソフト改行が発生しない＝割れない）", () => {
    const out = wrapEmailHtml(RECOVERY_BODY);
    for (const line of out.split("\n")) {
      expect(qpLineLength(line)).toBeLessThanOrEqual(76);
    }
  });

  it("「パスワード」が分断されない（旧不具合の再現防止）", () => {
    const out = wrapEmailHtml(RECOVERY_BODY);
    expect(renderToText(out)).toContain("パスワード");
    // QPソフト改行が起きない＝各行76以下、を二重に確認
    for (const line of out.split("\n")) expect(qpLineLength(line)).toBeLessThanOrEqual(76);
  });

  it("実際の <p> 本文（タグ付き）でもQP76以下を満たす", () => {
    const html = `<p style="font-size:14px;color:#55575d;line-height:1.7">${RECOVERY_BODY}</p>`;
    const out = wrapEmailHtml(html);
    for (const line of out.split("\n")) expect(qpLineLength(line)).toBeLessThanOrEqual(76);
    expect(renderToText(out)).toBe(html);
  });

  it("タグ内（href の URL）には改行を入れずリンクを壊さない", () => {
    const url =
      "https://gymboard.lovable.app/reset-password?token_hash=abcdef0123456789abcdef0123456789&type=recovery";
    const html = `<a href="${url}" target="_blank">パスワードを再設定する</a>`;
    const out = wrapEmailHtml(html);
    expect(out).toContain(`href="${url}"`);
  });

  it("ASCII のみのテキストはそのまま（既存挙動を維持）", () => {
    expect(wrapEmailHtml("<p>Hello, world!</p>")).toBe("<p>Hello, world!</p>");
  });
});

describe("makeEmailHtmlAsciiSafe（予約メール文字化け対策）", () => {
  it("HTMLテキストだけをASCII安全な数値文字参照にし、見た目の日本語は維持する", () => {
    const html = `<p>アプリからキャンセル・変更が可能です。</p><a href="https://gymboard.app">▼ アプリを開く</a>`;
    const out = makeEmailHtmlAsciiSafe(wrapEmailHtml(html));

    expect(out).not.toContain("アプリ");
    expect(out).toContain("&#12450;"); // ア
    expect(out).toContain("&#12539;"); // ・
    expect(out).toContain("&#9660;"); // ▼
    expect(out).toContain('href="https://gymboard.app"');

    const decoded = out
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, "&");
    expect(decoded).toBe(html);
  });

  it("体験予約確認メールの主要本文はrenderAsync前にASCII数値文字参照化される", () => {
    const source = readFileSync(
      "supabase/functions/_shared/transactional-email-templates/trial-booking-confirmation.tsx",
      "utf8",
    );

    expect(source).toContain("const SafeText");
    expect(source).toContain("const SafeHeading");
    expect(source).toContain("const SafeInlineText");
    expect(source).toContain("dangerouslySetInnerHTML={{ __html: toHtmlEntities(children) }}");
    expect(source).toContain("<SafeText style={text}>ご都合が悪くなった場合は、下記のボタンからいつでもキャンセルできます。</SafeText>");
    expect(source).toContain("<Button href={cancelUrl} style={cancelButton}><SafeInlineText>予約をキャンセルする</SafeInlineText></Button>");
    expect(source).toContain("<SafeText style={text}>お会いできることを楽しみにしております！</SafeText>");
  });
});

// ---------------------------------------------------------------------------
// 🔴 ストリーミング描画を使っていないこと（2026-08-06 追加）
// ---------------------------------------------------------------------------
//
// `@react-email/render@0.0.17` の browser ビルド（**Deno が引く方**）は
// `readStream` で `decoder.decode(chunk)` を **`{ stream: true }` 無し**で呼ぶ。
// 各チャンクを独立した完結UTF-8列として復号するので、**境界をまたいだ
// 多バイト文字が U+FFFD に化ける。**
//
// ⚠️ **Node では再現しない。** Deno だけが `renderToReadableStream` の経路に入る。
//    だから「手元で試したら大丈夫だった」は根拠にならない。
//
// ⚠️ **入力の長さ次第で化けたり化けなかったりする。**
//    実測（実 Deno / 予約確認メールの宛名を1〜60文字で振る）:
//      renderAsync … 3件で化けた（宛名1〜3文字。「アプ?からキャンセル」）
//      render      … 0件
//    修正後は取引メール8種 × 40通り = 320検体すべて化け0を確認済み。
//
// vitest は `.tsx`（`npm:react`）を import できないので描画結果は検査できない。
// **ソースを見て `renderAsync` が復活していないこと**を見張る。

describe("メール描画にストリーミングを使っていない", () => {
  const FILES = [
    "supabase/functions/send-transactional-email/index.ts",
    "supabase/functions/auth-email-hook/index.ts",
  ];

  for (const file of FILES) {
    it(`${file} が renderAsync を使っていない`, () => {
      const code = readFileSync(file, "utf8")
        .replace(/\/\/[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(
        code,
        `${file} に renderAsync が復活しています。Deno のストリーミング描画は ` +
          `日本語を U+FFFD に壊します（TextDecoder が stream モードでないため）。` +
          `同期の render を使ってください`,
      ).not.toMatch(/renderAsync/);
    });
  }

  it("取引メールは同期の render を使っている（空振り防止）", () => {
    const code = readFileSync(FILES[0], "utf8");
    expect(code).toMatch(/import \{ render \} from/);
    expect(code).toMatch(/const rawHtml = render\(/);
    expect(code).toMatch(/const plainText = render\(/);
  });
});
