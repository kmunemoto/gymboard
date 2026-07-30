import { describe, it, expect } from "vitest";
import { sanitizeAuthNext } from "@/lib/nativeBridge";

// AuthCallback のオープンリダイレクト対策。攻撃者が
//   https://app.kyoto-salute.com/auth/callback?token_hash=...&next=https://evil.example
// のようなURLを確認メールに見せかけて送ると、確認処理の直後に任意サイトへ飛ばせてしまう。
// jsdom の既定オリジンは http://localhost:3000。

describe("sanitizeAuthNext", () => {
  it("null/未指定はそのまま null", () => {
    expect(sanitizeAuthNext(null)).toBeNull();
    expect(sanitizeAuthNext(undefined)).toBeNull();
    expect(sanitizeAuthNext("")).toBeNull();
  });

  it("「/」始まりの相対パスは許可する", () => {
    expect(sanitizeAuthNext("/join/ABC123")).toBe("/join/ABC123");
    expect(sanitizeAuthNext("/")).toBe("/");
  });

  it("「//」始まり（プロトコル相対URL）は破棄する", () => {
    // ブラウザは "//evil.example/x" を「現在のプロトコルで evil.example へ」と解釈する
    expect(sanitizeAuthNext("//evil.example/x")).toBeNull();
  });

  it("自オリジンと一致する絶対URLは許可する", () => {
    expect(sanitizeAuthNext("http://localhost:3000/join/ABC123")).toBe(
      "http://localhost:3000/join/ABC123",
    );
  });

  it("他ホストの絶対URLは破棄する（本体の脆弱性）", () => {
    expect(sanitizeAuthNext("https://evil.example/phishing")).toBeNull();
    expect(sanitizeAuthNext("http://evil.example")).toBeNull();
    expect(sanitizeAuthNext("https://app.kyoto-salute.com.evil.example")).toBeNull();
  });

  it("ネイティブアプリのカスタムURLスキームは許可する", () => {
    // supabase/functions/auth-email-hook が emailRedirectTo をそのまま next に載せて送ってくる、
    // アプリへ戻すための正規の遷移先。ここを弾くと確認メールからアプリに戻れなくなる。
    expect(sanitizeAuthNext("app.gymboard.mobile://auth/callback")).toBe(
      "app.gymboard.mobile://auth/callback",
    );
  });

  it("javascript: など危険なスキームは破棄する", () => {
    expect(sanitizeAuthNext("javascript:alert(1)")).toBeNull();
  });

  it("壊れたURL文字列は例外を投げずに破棄する", () => {
    expect(() => sanitizeAuthNext("http://[invalid")).not.toThrow();
    expect(sanitizeAuthNext("http://[invalid")).toBeNull();
  });
});
