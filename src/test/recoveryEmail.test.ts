import { describe, it, expect } from "vitest";
import {
  renderRecoveryHtml,
  renderRecoveryText,
} from "../../supabase/functions/_shared/email-templates/recovery-plain";
import { BRAND } from "@/lib/brand";

// 本文の製品名は brand.ts から引く。直書きすると、兄弟アプリ（業種特化フォーク）が
// Edge Function のテンプレートを自分のブランド名に変えた瞬間にこのテストが落ちる。
// brand.ts から引いておけば、逆に「テンプレートと brand.ts のブランド名が食い違う」
// ことを検出する番人になる（Edge Function は Deno なので brand.ts を import できず、
// 両者が手動で同期されている前提のため、この突き合わせに意味がある）。
// 文字化けの検証にブランド名を混ぜない（フォークで Edge Function 側のブランドを
// 差し替えると、エンコーディングと無関係な理由で落ちてしまう）。
// ブランド名の一致は末尾の独立したテストで見る。
const RECOVERY_LEAD = "のパスワード再設定リクエストを受け付けました。";

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
    expect(decoded).toContain(RECOVERY_LEAD);
    expect(decoded).toContain("新しいパスワードを設定してください。");
    expect(decoded).toContain("パスワードを再設定する");
  });

  it("HTML表示テキストはASCII安全な数値文字参照で送る", () => {
    const html = renderRecoveryHtml(URL);
    expect(html).not.toContain("のパスワード再設定リクエスト");
    expect(html).toContain("&#12497;"); // パ
    expect(html).toContain("&#12540;"); // ー
    expect(html).toContain("<!--\n-->");
  });

  it("プレーンテキストも文字化けせず日本語が正しい", () => {
    const text = renderRecoveryText(URL);
    expect(text).not.toContain("�");
    expect(text).toContain(RECOVERY_LEAD);
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
    const i = decoded.indexOf("のパスワード再設定リクエスト");
    expect(i).toBeGreaterThan(-1);
  });
});

// Edge Function は Deno なので brand.ts を import できず、テンプレートの製品名は
// 手で同期する前提（mem/ops/vertical-fork.md 地雷4）。ここがその同期の番人。
// フォークが brand.ts だけ変えてテンプレートを直し忘れると、お客様に届くメールが
// 複製元の製品名を名乗る。
describe("メールテンプレートのブランド名が brand.ts と一致する", () => {
  it("パスワード再設定メールの本文が BRAND.ja を名乗る", () => {
    const html = renderRecoveryHtml(URL);
    const text = renderRecoveryText(URL);
    const expected = `${BRAND.ja}のパスワード再設定リクエスト`;
    const hint =
      `supabase/functions/_shared/email-templates/recovery-plain.ts の製品名が ` +
      `brand.ts の BRAND.ja（${BRAND.ja}）と一致していません。` +
      `Edge Function は brand.ts を読めないので手で揃える必要があります。`;
    expect(decodeHtmlForAssertion(html), hint).toContain(expected);
    expect(text, hint).toContain(expected);
  });
});
