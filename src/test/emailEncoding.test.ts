import { describe, it, expect } from "vitest";
import { escapeNonAsciiToEntities } from "../../supabase/functions/_shared/email-encoding";

// パスワード再設定メール本文（recovery.tsx の本文と同一）。
// 送信経路の固定幅折り返しで「パスワード」が「パスワ???ード」と化けていた回帰対象。
const RECOVERY_BODY =
  "ジムボードのパスワード再設定リクエストを受け付けました。下のボタンから新しいパスワードを設定してください。";

// メールクライアントの描画を模す: HTMLコメントは無描画、数値文字参照は復号。
function renderToText(escaped: string): string {
  return escaped
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

// 転送経路が固定桁でハード折り返しする様子を模す（既存改行でリセット）。
// 参照やマルチバイトの「途中」に改行が入ると文字化けが発生する。
function hardWrapAt(s: string, width: number): string {
  return s
    .split("\n")
    .map((line) => {
      const chunks: string[] = [];
      for (let i = 0; i < line.length; i += width) chunks.push(line.slice(i, i + width));
      return chunks.join("\n");
    })
    .join("\n");
}

describe("escapeNonAsciiToEntities（メール文字化け対策）", () => {
  it("出力は ASCII のみ（生UTF-8バイトが折り返しで割れない）", () => {
    const out = escapeNonAsciiToEntities(RECOVERY_BODY);
    expect([...out].every((c) => c.charCodeAt(0) <= 127)).toBe(true);
  });

  it("各行は十分短く、転送側がトークンの途中で折り返さない", () => {
    const out = escapeNonAsciiToEntities(RECOVERY_BODY);
    for (const line of out.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  it("描画すると元の本文に完全復元される（欠落・余分な空白なし）", () => {
    const out = escapeNonAsciiToEntities(RECOVERY_BODY);
    expect(renderToText(out)).toBe(RECOVERY_BODY);
  });

  it("転送側のハード折り返し(76桁)を通しても化けない（回帰テスト）", () => {
    const out = escapeNonAsciiToEntities(RECOVERY_BODY);
    const transported = hardWrapAt(out, 76);
    expect(renderToText(transported)).toBe(RECOVERY_BODY);
  });

  it("「パスワード」が分断されない（旧実装の再現防止）", () => {
    const out = escapeNonAsciiToEntities(RECOVERY_BODY);
    const transported = hardWrapAt(out, 76);
    // 復元後に「パスワード」がそのまま含まれること（パスワ???ード にならない）
    expect(renderToText(transported)).toContain("パスワード");
  });

  it("タグ内（href の URL）には改行を入れずリンクを壊さない", () => {
    const url =
      "https://gymboard.lovable.app/reset-password?token_hash=abcdef0123456789abcdef0123456789&type=recovery";
    const html = `<a href="${url}" target="_blank">パスワードを再設定する</a>`;
    const out = escapeNonAsciiToEntities(html);
    expect(out).toContain(`href="${url}"`);
  });

  it("ASCII テキストはそのまま（既存挙動を維持）", () => {
    expect(escapeNonAsciiToEntities("<p>Hello, world!</p>")).toBe("<p>Hello, world!</p>");
  });
});
