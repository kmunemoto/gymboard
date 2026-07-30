import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// AuthCallback.tsx はほぼ全体が window.location.replace を伴う実ページ遷移で、
// jsdom はナビゲーションを実装していない（location.replace を呼ぶと落ちる）ため、
// レンダリングしての end-to-end テストが組めない。
// 純粋関数側の網羅（許可/拒否パターン）は authNextSanitize.test.ts が持っているので、
// ここでは「実際に呼び出し側がその関数を通しているか」をソースレベルで固定する
// （src/test/businessProfile.test.ts の直接比較禁止テストと同じ作法）。

const src = readFileSync("src/pages/AuthCallback.tsx", "utf8");

describe("AuthCallback のオープンリダイレクト対策が外れていないこと", () => {
  it("next を sanitizeAuthNext に通してから使っている", () => {
    expect(src).toContain('import { sanitizeAuthNext } from "@/lib/nativeBridge"');
    expect(src).toMatch(/const next = sanitizeAuthNext\(params\.get\("next"\)\)/);
  });

  it("params.get(\"next\") を未加工のまま replace に渡していない", () => {
    // 「params.get("next")」がそのまま .replace(...) の引数に現れたら退行のサイン
    expect(src).not.toMatch(/\.replace\([^)]*params\.get\("next"\)/);
  });

  it("verifyOtp のエラーは message ではなく code をURLに載せる", () => {
    // message は英文かつgotrueのバージョンで文言が変わる。生の英文をcrクエリに
    // 載せると、Auth.tsx 側での日本語化（otp_expired 等）が機能しなくなる。
    expect(src).not.toMatch(/error=\$\{encodeURIComponent\(error\.message\)\}/);
    expect(src).toMatch(/error=\$\{encodeURIComponent\(code\)\}/);
  });

  it("verifyOtp の catch（想定外エラー）も error パラメータ無しで握りつぶさない", () => {
    expect(src).toMatch(/verifyOtp unexpected error[\s\S]{0,120}\/auth\?error=generic/);
  });
});
