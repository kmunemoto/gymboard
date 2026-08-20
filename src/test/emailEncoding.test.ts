import { describe, it, expect } from "vitest";
import { makeEmailHtmlAsciiSafe } from "../../supabase/functions/_shared/email-encoding";
import { readFileSync } from "node:fs";
import { BRAND } from "@/lib/brand";

// パスワード再設定メール本文（recovery.tsx の本文と同一）。
// 送信経路の固定幅折り返しで「パスワード」が「パスワ???ード」と化けていた回帰対象。
// 製品名は brand.ts から引く（recoveryEmail.test.ts と同じ理由）。
const RECOVERY_BODY =
  `${BRAND.ja}のパスワード再設定リクエストを受け付けました。下のボタンから新しいパスワードを設定してください。`;

// メールクライアントの描画を模す: 実体参照をデコードする。
const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

describe("🔴 本文に文字を挿入しない（2026-08-18 の「キ??ンセル」）", () => {
  // ── 何が起きたか ────────────────────────────────────────────
  // 文字化け対策として入れた HTML コメント `<!--\n-->` が、一部のメール
  // クライアントで**可視化された**。予約確認メールで
  //   「アプリからキ??ンセル・変更が可能です。」
  // と表示された（「ャ」の両側にコメントが挿入されていた）。
  //
  // 当時から「Gmail iOS ダークモード等で豆腐化して見えることがあった」と
  // 分かっていて、折り返し幅を広げて**頻度を下げただけ**だった。
  //
  // ASCII 化した時点で quoted-printable は本文を壊せない（ソフト改行は
  // 受信側で完全に元へ戻る）ので、こちらが折る必要がそもそも無い。

  it("HTML コメントを一切挿入しない", () => {
    const out = makeEmailHtmlAsciiSafe(`<p>${RECOVERY_BODY}</p>`);
    expect(out, "本文に HTML コメントが挿入されています").not.toContain("<!--");
  });

  it("報告された文面がそのまま復元できる（キ??ンセルの回帰）", () => {
    const body = "アプリからキャンセル・変更が可能です。";
    const out = makeEmailHtmlAsciiSafe(`<p>${body}</p>`);
    expect(out).not.toContain("<!--");
    expect(decodeEntities(out)).toBe(`<p>${body}</p>`);
  });

  it("長い日本語でもコメントを入れない", () => {
    const long = "あ".repeat(300);
    const out = makeEmailHtmlAsciiSafe(`<p>${long}</p>`);
    expect(out).not.toContain("<!--");
    expect(decodeEntities(out)).toBe(`<p>${long}</p>`);
  });

  it("recovery 側の encodeHtmlTextSafely もコメントを挿入しない", () => {
    // 同じ実装が4箇所にあった（email-encoding の2つ / auth-plain の enc /
    // recovery-plain の encodeHtmlTextSafely）。1つでも残ると症状が戻る。
    const src = readFileSync("supabase/functions/_shared/email-templates/recovery-plain.ts", "utf8");
    const body = src.slice(src.indexOf("function encodeHtmlTextSafely("));
    expect(body.slice(0, 400), "recovery の encodeHtmlTextSafely がコメントを挿入しています").not.toContain('out += "<!--');
  });

  it("auth 側の enc() もコメントを挿入しない", () => {
    // ここも同じ方式で折っていた（パスワード再設定・サインアップの本文）。
    const src = readFileSync("supabase/functions/_shared/email-templates/auth-plain.ts", "utf8");
    const encBody = src.slice(src.indexOf("function enc("), src.indexOf("function enc(") + 400);
    expect(encBody, "auth の enc() が HTML コメントを挿入しています").not.toContain('out += "<!--');
  });

  it("送信経路の2つが同じ方式に揃っている", () => {
    const tx = readFileSync("supabase/functions/send-transactional-email/index.ts", "utf8");
    const auth = readFileSync("supabase/functions/auth-email-hook/index.ts", "utf8");
    expect(tx).toContain("makeEmailHtmlAsciiSafe(rawHtml)");
    expect(auth).toContain("makeEmailHtmlAsciiSafe(rawHtml)");
    // 削除した関数が復活していないこと
    expect(tx).not.toMatch(/wrapEmailHtml\(/);
    expect(auth).not.toMatch(/wrapEmailHtml\(/);
  });
});

describe("makeEmailHtmlAsciiSafe: 改行は元の空白の位置だけ", () => {
  it("改行を入れても描画は変わらない（空白→改行の置換のみ）", () => {
    // HTML では空白も改行も同じ空白に畳まれるので、置換しても見た目は同じ。
    const html = `<p>${"word ".repeat(40)}end</p>`;
    const out = makeEmailHtmlAsciiSafe(html);
    expect(out).not.toContain("<!--");
    // 空白を1つに畳めば元と一致する
    const collapse = (x: string) => x.replace(/\s+/g, " ");
    expect(collapse(out)).toBe(collapse(html));
  });

  it("タグ内（href の URL）は改行しない", () => {
    const url = "https://gymboard.lovable.app/reset-password?token_hash=abcdef0123456789abcdef0123456789&type=recovery";
    const out = makeEmailHtmlAsciiSafe(`<a href="${url}" target="_blank">パスワードを再設定する</a>`);
    expect(out).toContain(`href="${url}"`);
  });

  it("ASCII のみのテキストはそのまま", () => {
    expect(makeEmailHtmlAsciiSafe("<p>Hello, world!</p>")).toBe("<p>Hello, world!</p>");
  });

  it("既に実体参照になっている入力を二重エンコードしない（冪等）", () => {
    // auth 側は enc() で ASCII 化済みのものが渡ってくる。
    const once = makeEmailHtmlAsciiSafe("<p>キャンセル</p>");
    expect(makeEmailHtmlAsciiSafe(once)).toBe(once);
  });
});

describe("makeEmailHtmlAsciiSafe（予約メール文字化け対策）", () => {
  it("HTMLテキストだけをASCII安全な数値文字参照にし、見た目の日本語は維持する", () => {
    const html = `<p>アプリからキャンセル・変更が可能です。</p><a href="https://gymboard.app">▼ アプリを開く</a>`;
    const out = makeEmailHtmlAsciiSafe(html);

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
