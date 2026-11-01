/**
 * AI 連携（OAuth）の同意画面（2026-11-01・点検の拡大 oauth-consent-1）。
 *   `src/lib/oauthConsent.ts`・`src/pages/OAuthConsent.tsx`
 *
 * 本番の OAuth サーバーは動的なクライアント登録が開いていた（/.well-known/oauth-authorization-server に
 * registration_endpoint がある）。誰でも「ジムボード」という名前のアプリを登録し、オーナーに偽の連携リンクを踏ませて
 * 「許可する」を押させれば、オーナーとして読み書きできるトークン（全お客様の情報に届く）を取れた。
 * 同意画面は「読み取れるようになります」とだけ出し、戻り先のドメインも出していなかった。
 *
 * 直し方（画面）: 戻り先のドメインを見せる・「読み書き」と正しく書く・スタッフには強い警告・戻り先が https（か手元の PC）
 * でなければ進まない。サーバー側（動的登録を止める）は宗本さんの判断待ち（mem/ops/tenant-boundary.md 穴27）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isAllowedOAuthReturn, isStaffRole, oauthReturnHost } from "@/lib/oauthConsent";

describe("isAllowedOAuthReturn: 連携のあとに戻ってよい先", () => {
  it("https と、手元の PC の http://localhost は可（Claude などの AI クライアント）", () => {
    expect(isAllowedOAuthReturn("https://claude.ai/api/mcp/auth_callback?code=x")).toBe(true);
    expect(isAllowedOAuthReturn("http://localhost:3000/callback")).toBe(true);
    expect(isAllowedOAuthReturn("http://127.0.0.1:8080/cb")).toBe(true);
  });

  it("🔴 javascript: / data: / http（手元以外）/ 壊れた値は不可", () => {
    expect(isAllowedOAuthReturn("javascript:alert(1)")).toBe(false);
    expect(isAllowedOAuthReturn("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isAllowedOAuthReturn("http://evil.example/cb")).toBe(false);
    expect(isAllowedOAuthReturn("//evil.example/cb")).toBe(false);
    expect(isAllowedOAuthReturn("")).toBe(false);
    expect(isAllowedOAuthReturn(null)).toBe(false);
    expect(isAllowedOAuthReturn(42)).toBe(false);
  });
});

describe("oauthReturnHost: 画面に出す連携先", () => {
  it("戻り先のホスト名を返す（名前ではなくドメインを見せる）", () => {
    expect(oauthReturnHost("https://evil.example/oauth/cb?x=1")).toBe("evil.example");
    expect(oauthReturnHost("http://localhost:3000/cb")).toBe("localhost:3000");
  });

  it("戻ってよい先でなければ null（許可のボタンを押せなくする）", () => {
    expect(oauthReturnHost("javascript:alert(1)")).toBeNull();
    expect(oauthReturnHost(undefined)).toBeNull();
  });
});

describe("isStaffRole", () => {
  it("オーナー・インストラクターだけ", () => {
    expect(isStaffRole("owner")).toBe(true);
    expect(isStaffRole("trainer")).toBe(true);
    expect(isStaffRole("customer")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
});

describe("同意画面（OAuthConsent.tsx）", () => {
  const src = readFileSync("src/pages/OAuthConsent.tsx", "utf8");

  it("🔴 画面を離れる前に、戻り先を確かめる（同意が要らない場合・許可/拒否のあと、どちらも）", () => {
    const navigations = [...src.matchAll(/window\.location\.href = (immediate|target);/g)].map((m) => m[1]);
    expect(navigations.sort()).toEqual(["immediate", "target"]);
    for (const v of ["immediate", "target"]) {
      const checkAt = src.indexOf(`if (!isAllowedOAuthReturn(${v}))`);
      const goAt = src.indexOf(`window.location.href = ${v};`);
      expect(checkAt, v).toBeGreaterThan(-1);
      expect(checkAt, v).toBeLessThan(goAt);
      // 確かめてから離れるまでの間に、別の値へ差し替えていない
      expect(src.slice(checkAt, goAt), v).not.toMatch(new RegExp(`${v}\\s*=`));
    }
  });

  it("🔴 連携先のドメインを出し、分からなければ許可できない", () => {
    expect(src).toContain("const returnHost = oauthReturnHost(details.redirect_uri);");
    expect(src).toContain("{returnHost ?? ");
    expect(src).toContain("<Button disabled={busy || !returnHost} onClick={() => decide(true)}>");
  });

  it("「読み取りだけ」と誤解させない・スタッフには強い警告を出す", () => {
    expect(src).not.toContain("を読み取れるようになります");
    expect(src).toContain("読み書きできるようになります");
    expect(src).toContain("const staff = isStaffRole(role);");
    expect(src).toMatch(/\{staff && \(/);
  });
});
