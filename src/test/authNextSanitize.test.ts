import { describe, it, expect } from "vitest";
import { sanitizeAuthNext } from "@/lib/nativeBridge";
import { NATIVE_APP_SCHEME } from "@/lib/brand";

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
    //
    // スキームは brand.ts から引く。ここに "app.gymboard.mobile" と直書きすると、
    // 兄弟アプリ（業種特化フォーク）が brand.ts を書き換えた瞬間にこのテストが落ち、
    // フォーク側が上流のテストを編集する羽目になる（＝毎回のマージで衝突する）。
    const callback = `${NATIVE_APP_SCHEME}//auth/callback`;
    expect(sanitizeAuthNext(callback)).toBe(callback);
  });

  it("javascript: など危険なスキームは破棄する", () => {
    expect(sanitizeAuthNext("javascript:alert(1)")).toBeNull();
  });

  it("🔴 「/」始まりでも、ブラウザが外へ解決する形は破棄する（2026-10-31 点検 auth-callback-next-1）", () => {
    // http(s) ではバックスラッシュは "/" と同じに扱われ、タブ・改行は取り除かれる。
    // どれも「/ で始まり // で始まらない」を通るのに、開くと https://evil.example/ に着地していた
    for (const next of ["/\\evil.example/login", "/\t/evil.example/login", "/\n/evil.example/login", "/\\/evil.example"]) {
      expect(sanitizeAuthNext(next), JSON.stringify(next)).toBeNull();
    }
  });

  it("通した値は、解決しても自分のオリジンから出ない", () => {
    for (const next of ["/join/ABC123", "/kb?x=1#a", "/%5Cevil", "/oauth/consent?authorization_id=x"]) {
      const out = sanitizeAuthNext(next);
      expect(out, next).toBe(next);
      expect(new URL(out!, window.location.origin).origin).toBe(window.location.origin);
    }
  });

  it("壊れたURL文字列は例外を投げずに破棄する", () => {
    expect(() => sanitizeAuthNext("http://[invalid")).not.toThrow();
    expect(sanitizeAuthNext("http://[invalid")).toBeNull();
  });
});
