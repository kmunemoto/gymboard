import { describe, it, expect } from "vitest";
import {
  renderRecoveryHtml,
  renderRecoveryText,
} from "../../supabase/functions/_shared/email-templates/recovery-plain";

const URL =
  "https://gymboard.lovable.app/reset-password?token_hash=abcdef0123456789&type=recovery";

describe("recovery-plain（素のテンプレート文字列・文字化けしない）", () => {
  it("HTML本文に文字化け(U+FFFD)が無く、日本語が正しく含まれる", () => {
    const html = renderRecoveryHtml(URL);
    expect(html).not.toContain("�"); // 置換文字（???）が無い
    expect(html).toContain("パスワードの再設定");
    expect(html).toContain("ジムボードのパスワード再設定リクエストを受け付けました。");
    expect(html).toContain("新しいパスワードを設定してください。");
    expect(html).toContain("パスワードを再設定する");
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
    // U+30D1 U+30B9 U+30EF U+30FC U+30C9 が連続している
    expect(html.includes("パスワード")).toBe(true);
    const i = html.indexOf("ジムボードのパスワード");
    expect(i).toBeGreaterThan(-1);
  });
});
