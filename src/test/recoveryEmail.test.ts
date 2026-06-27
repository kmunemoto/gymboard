import { describe, it, expect } from "vitest";
import {
  renderRecoveryHtml,
  renderRecoveryText,
} from "../../supabase/functions/_shared/email-templates/recovery-plain";

const URL =
  "https://gymboard.lovable.app/reset-password?token_hash=abcdef0123456789&type=recovery";

const decodeHtmlForAssertion = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

describe("recovery-plain（素のテンプレート文字列・文字化けしない）", () => {
  it("HTML本文に文字化け(U+FFFD)が無く、日本語が正しく含まれる", () => {
    const html = renderRecoveryHtml(URL);
    const decoded = decodeHtmlForAssertion(html);
    expect(html).not.toContain("�"); // 置換文字（???）が無い
    expect(decoded).toContain("パスワードの再設定");
    expect(decoded).toContain("ジムボードのパスワード再設定リクエストを受け付けました。");
    expect(decoded).toContain("新しいパスワードを設定してください。");
    expect(decoded).toContain("パスワードを再設定する");
  });

  it("HTML表示テキストはASCII安全な数値文字参照で送る", () => {
    const html = renderRecoveryHtml(URL);
    expect(html).not.toContain("ジムボードのパスワード");
    expect(html).toContain("&#12497;"); // パ
    expect(html).toContain("&#12540;"); // ー
    expect(html).toContain("<!--\n-->");
  });

  it("プレーンテキストも文字化けせず日本語が正しい", () => {
    const text = renderRecoveryText(URL);
    expect(text).not.toContain("�");
    expect(text).toContain("ジムボードのパスワード再設定リクエストを受け付けました。");
    expect(text).toContain("パスワード");
  });

  it("リンクURLが壊れず含まれる（& は &amp; にエスケープ）", () => {
    const html = renderRecoveryHtml(URL);
    expect(html).toContain(
      'href="https://gymboard.lovable.app/reset-password?token_hash=abcdef0123456789&amp;type=recovery"',
    );
  });

  it("「パスワード」が分断されていない（旧不具合の再現防止）", () => {
    const html = renderRecoveryHtml(URL);
    const decoded = decodeHtmlForAssertion(html);
    // U+30D1 U+30B9 U+30EF U+30FC U+30C9 が連続している
    expect(decoded.includes("パスワード")).toBe(true);
    const i = decoded.indexOf("ジムボードのパスワード");
    expect(i).toBeGreaterThan(-1);
  });
});
