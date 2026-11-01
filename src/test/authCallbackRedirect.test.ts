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

  it("🔴 ログイン前に保存した戻り先（postAuthRedirect）も、アプリの中のパスか確かめてから使う（2026-10-31 点検 auth-redirect-1）", () => {
    // 中身はログイン画面の ?redirect=（URL 由来）。確かめずに replace すると javascript: が本番のドメインで動いた
    expect(src).toMatch(/const readPostAuthRedirect = \(\): string \| null => \{\s*const raw = sessionStorage\.getItem\("postAuthRedirect"\);\s*sessionStorage\.removeItem\("postAuthRedirect"\);\s*return isSafeInAppPath\(raw\) \? raw : null;/);
    // 生の sessionStorage の値を replace に渡す形が残っていない
    expect(src.match(/sessionStorage\.getItem\("postAuthRedirect"\)/g)?.length).toBe(1);
    // 使うのは ?code= の戻りだけ（#access_token の受け口は 2026-11-01 に消した。authCallbackAccountSwitch.test.tsx）
    expect(src.match(/const dest = readPostAuthRedirect\(\);/g)?.length).toBe(1);
  });

  it("ログイン画面の ?redirect= は確かめてから使い、ソーシャルログインの前にも確かめて保存する", () => {
    const auth = readFileSync("src/pages/Auth.tsx", "utf8");
    expect(auth).toContain('const rawRedirectParam = searchParams.get("redirect");');
    expect(auth).toContain("const redirectParam = isSafeInAppPath(rawRedirectParam) ? rawRedirectParam : null;");
    // 生の値は、取り出す行と確かめる行（2回）にしか出てこない＝どこにも生のまま使っていない
    expect(auth.match(/rawRedirectParam/g)?.length).toBe(3);
    const social = readFileSync("src/components/SocialAuthButtons.tsx", "utf8");
    expect(social).toMatch(/if \(redirectParam && isSafeInAppPath\(redirectParam\)\) \{\s*sessionStorage\.setItem\("postAuthRedirect", redirectParam\);/);
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
