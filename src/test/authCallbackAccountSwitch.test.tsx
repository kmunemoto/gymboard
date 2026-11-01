/**
 * ログイン用のリンクで、別のアカウントに黙って切り替えさせない（2026-11-01・点検の拡大 auth-callback-session-1）。
 *   `src/hooks/useAccountSwitchConfirm.tsx`・`src/pages/AuthCallback.tsx`・`src/pages/ResetPassword.tsx`・`src/main.tsx`
 *
 * 今までは、/auth/callback（とアプリの app.gymboard.mobile://auth/callback）が URL の #access_token / #refresh_token を
 * 確かめずに setSession していたので、他人が自分のトークン入りのリンクを開かせるだけで、そのアカウントに切り替わった。
 * そっくりのジムを作っておけば、本人は気づかずに体重・写真・相談を入力し、それが相手のジムに入る。
 * メールのリンク（token_hash）も、ログイン中かどうかを見ずに切り替えていた。
 *
 * 直し方: #access_token は受け取らない（正規の経路は PKCE の ?code= と ?token_hash= だけ）。
 * token_hash は、すでに誰かがログインしていたら、切り替える前に「今のアカウント」を見せて選んでもらう。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";

const h = vi.hoisted(() => ({ session: null as null | { user: { email?: string } } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: h.session }, error: null }),
    },
  },
}));

import { useAccountSwitchConfirm } from "@/hooks/useAccountSwitchConfirm";

function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
  const { confirmSwitch, dialog } = useAccountSwitchConfirm();
  return (
    <div>
      <button onClick={async () => onResult(await confirmSwitch())}>ask</button>
      {dialog}
    </div>
  );
}

const ask = async () => {
  const results: boolean[] = [];
  render(<Harness onResult={(ok) => results.push(ok)} />);
  fireEvent.click(screen.getByText("ask"));
  return results;
};

describe("useAccountSwitchConfirm: ログイン中なら、切り替える前に確かめる", () => {
  beforeEach(() => {
    h.session = null;
  });

  it("ログインしていなければ、何も出さずに進む（今まで通り）", async () => {
    const results = await ask();
    await waitFor(() => expect(results).toEqual([true]));
    expect(screen.queryByText(i18n.t("authCallback.switchTitle"))).toBeNull();
  });

  it("🔴 ログイン中なら、今のアカウントを見せて止まる。「今のアカウントのまま」なら進まない", async () => {
    h.session = { user: { email: "me@example.com" } };
    const results = await ask();
    await screen.findByText(i18n.t("authCallback.switchTitle"));
    expect(screen.getByText(i18n.t("authCallback.switchBody", { email: "me@example.com" }))).toBeInTheDocument();
    expect(results).toEqual([]);
    fireEvent.click(screen.getByText(i18n.t("authCallback.switchStay")));
    await waitFor(() => expect(results).toEqual([false]));
    await waitFor(() => expect(screen.queryByText(i18n.t("authCallback.switchTitle"))).toBeNull());
  });

  it("「リンクを開いて続ける」を選んだときだけ進む", async () => {
    h.session = { user: { email: "me@example.com" } };
    const results = await ask();
    fireEvent.click(await screen.findByText(i18n.t("authCallback.switchContinue")));
    await waitFor(() => expect(results).toEqual([true]));
  });

  it("Esc で閉じたら進まない（安全な側）", async () => {
    h.session = { user: { email: "me@example.com" } };
    const results = await ask();
    const title = await screen.findByText(i18n.t("authCallback.switchTitle"));
    fireEvent.keyDown(title, { key: "Escape" });
    await waitFor(() => expect(results).toEqual([false]));
  });

  it("メールアドレスの無いアカウントでも、文面が崩れない", async () => {
    h.session = { user: {} };
    await ask();
    expect(await screen.findByText(i18n.t("authCallback.switchBodyNoEmail"))).toBeInTheDocument();
  });

  it("5言語とも文面がある", () => {
    for (const lng of ["ja", "en", "ko", "zh-CN", "zh-TW"]) {
      const json = JSON.parse(readFileSync(`src/locales/${lng}.json`, "utf8"));
      for (const k of ["switchTitle", "switchBody", "switchBodyNoEmail", "switchStay", "switchContinue"]) {
        expect(json.authCallback?.[k], `${lng}: authCallback.${k}`).toBeTruthy();
      }
      expect(json.authCallback.switchBody, lng).toContain("{{email}}");
    }
  });
});

describe("受け口（画面）", () => {
  const callback = readFileSync("src/pages/AuthCallback.tsx", "utf8");
  const reset = readFileSync("src/pages/ResetPassword.tsx", "utf8");
  const main = readFileSync("src/main.tsx", "utf8");

  it("🔴 /auth/callback は URL の #access_token / #refresh_token でログインしない", () => {
    expect(callback).not.toMatch(/setSession\(/);
    expect(callback).not.toMatch(/hashParams\.get\("access_token"\)/);
    expect(callback).not.toMatch(/window\.location\.hash/);
  });

  it("🔴 アプリのディープリンクは hash を /auth/callback に渡さない", () => {
    expect(main).toContain("window.location.href = `/auth/callback${parsed.search}`;");
    expect(main).not.toContain("${parsed.hash}");
  });

  it.each([
    ["AuthCallback", callback],
    ["ResetPassword", reset],
  ])("🔴 %s: メールのリンク（token_hash）は、切り替える前に確かめてから verifyOtp する", (_name, src) => {
    const askAt = src.indexOf("if (!(await confirmSwitch())) {");
    const verifyAt = src.indexOf("supabase.auth.verifyOtp(");
    expect(askAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeGreaterThan(askAt);
    // verifyOtp は1か所だけ（確かめない経路を作らない）
    expect(src.split("supabase.auth.verifyOtp(").length - 1).toBe(1);
    // 断ったら、リンクの行き先（next）ではなくホームへ
    expect(src.slice(askAt, verifyAt)).toContain('window.location.replace("/");');
    expect(src).toContain("{dialog}");
  });
});
