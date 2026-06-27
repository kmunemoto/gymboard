import { describe, it, expect } from "vitest";
import { wrapEmailHtml } from "../../supabase/functions/_shared/email-encoding";

// パスワード再設定メール本文（recovery.tsx の本文と同一）。
// 送信経路の固定幅折り返しで「パスワード」が「パスワ???ード」と化けていた回帰対象。
const RECOVERY_BODY =
  "ジムボードのパスワード再設定リクエストを受け付けました。下のボタンから新しいパスワードを設定してください。";

const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

// メールクライアントの描画を模す: HTMLコメントは無描画。本文は生UTF-8のまま。
const renderToText = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "");

// 送信経路が固定「バイト幅」でハード折り返しする様子を模す。
// 文字の途中（マルチバイトの境界内）に改行が入ると文字化けする。
function hardWrapBytes(s: string, width: number): string {
  return s
    .split("\n")
    .map((line) => {
      const bytes = enc.encode(line);
      const dec = new TextDecoder(); // fatal=false: 壊れた境界は U+FFFD になる
      const chunks: string[] = [];
      for (let i = 0; i < bytes.length; i += width) {
        chunks.push(dec.decode(bytes.slice(i, i + width)));
      }
      return chunks.join("\n");
    })
    .join("\n");
}

describe("wrapEmailHtml（メール文字化け対策・堅牢版）", () => {
  it("本文は生UTF-8のまま保持される（数値文字参照化しない）", () => {
    const out = wrapEmailHtml(RECOVERY_BODY);
    expect(out).not.toContain("&#"); // 参照化していない
    expect(renderToText(out)).toBe(RECOVERY_BODY);
  });

  it("各行のUTF-8バイト長が十分短く、転送側が文字の途中で折り返さない", () => {
    const out = wrapEmailHtml(RECOVERY_BODY);
    for (const line of out.split("\n")) {
      expect(byteLen(line)).toBeLessThanOrEqual(76);
    }
  });

  it("転送側のバイト幅ハード折り返し(76)を通しても化けない（回帰テスト）", () => {
    const out = wrapEmailHtml(RECOVERY_BODY);
    const transported = hardWrapBytes(out, 76);
    expect(transported).not.toContain("�"); // 文字境界が割れていない
    expect(renderToText(transported)).toBe(RECOVERY_BODY);
  });

  it("「パスワード」が分断されない（旧不具合の再現防止）", () => {
    const out = wrapEmailHtml(RECOVERY_BODY);
    const transported = hardWrapBytes(out, 76);
    expect(renderToText(transported)).toContain("パスワード");
  });

  it("タグ内（href の URL）には改行を入れずリンクを壊さない", () => {
    const url =
      "https://gymboard.lovable.app/reset-password?token_hash=abcdef0123456789abcdef0123456789&type=recovery";
    const html = `<a href="${url}" target="_blank">パスワードを再設定する</a>`;
    const out = wrapEmailHtml(html);
    expect(out).toContain(`href="${url}"`);
  });

  it("実際の <p> 本文でも分断されず描画できる", () => {
    const html = `<p style="font-size:14px;color:#55575d">${RECOVERY_BODY}</p>`;
    const out = wrapEmailHtml(html);
    for (const line of out.split("\n")) expect(byteLen(line)).toBeLessThanOrEqual(76);
    expect(renderToText(out)).toBe(html);
    expect(renderToText(hardWrapBytes(out, 76))).toContain("パスワード");
  });

  it("ASCII のみのテキストはそのまま（既存挙動を維持）", () => {
    expect(wrapEmailHtml("<p>Hello, world!</p>")).toBe("<p>Hello, world!</p>");
  });
});
