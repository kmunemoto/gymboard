/**
 * ジムの連絡先リンクに javascript: を入れられた穴・自分の LINE ID を書き換えて公式 LINE から誰にでも送れた穴
 * （2026-11-01・点検の拡大 tenant-contact-url-1 / line-link-1）。
 *   `supabase/migrations/20261101090000_contact_urls_and_line_id_guard.sql`・`src/lib/nativeBridge.ts`
 *
 * 本番で、適用前は「オーナーが javascript: の URL を入れられる」「お客様・オーナーが LINE ID を書き換えられる」、
 * 適用後は拒否（https の URL・連携の解除・サーバー側の連携は通る）を確かめた（mem/ops/tenant-boundary.md 穴28）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({ native: false, opened: [] as string[], browser: [] as string[] }));

vi.mock("@capacitor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@capacitor/core")>()),
  Capacitor: { isNativePlatform: () => h.native, getPlatform: () => "ios" },
}));
vi.mock("@capacitor/browser", () => ({
  Browser: { open: async ({ url }: { url: string }) => { h.browser.push(url); } },
}));

import { openExternalUrl } from "@/lib/nativeBridge";

const sql = readFileSync("supabase/migrations/20261101090000_contact_urls_and_line_id_guard.sql", "utf8")
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ");

describe("openExternalUrl: http(s) 以外は開かない", () => {
  beforeEach(() => {
    h.opened = [];
    h.browser = [];
    h.native = false;
    vi.spyOn(window, "open").mockImplementation((u?: string | URL) => {
      h.opened.push(String(u));
      return null;
    });
  });

  it("https は開く（Web・ネイティブとも）", async () => {
    await openExternalUrl("https://line.me/R/ti/p/@example");
    expect(h.opened).toEqual(["https://line.me/R/ti/p/@example"]);
    h.native = true;
    await openExternalUrl("https://g.page/r/example/review");
    expect(h.browser).toEqual(["https://g.page/r/example/review"]);
  });

  it("🔴 javascript: / data: / 壊れた値は開かない（Web・ネイティブとも）", async () => {
    for (const bad of ["javascript:alert(document.cookie)", "JavaScript:alert(1)", "data:text/html,<script>1</script>", "not a url"]) {
      await openExternalUrl(bad);
    }
    h.native = true;
    await openExternalUrl("javascript:alert(1)");
    expect(h.opened).toEqual([]);
    expect(h.browser).toEqual([]);
  });
});

describe("DB: ジムの連絡先リンクは http(s) だけ", () => {
  it.each(["line_url", "google_review_url", "website_url"])("🔴 %s に CHECK（NULL・空・http(s)）を付けて、既存の行も確かめた", (col) => {
    expect(sql).toContain(`ADD CONSTRAINT tenants_${col}_http CHECK (${col} IS NULL OR ${col} = '' OR ${col} ~* '^https?://') NOT VALID;`);
    expect(sql).toContain(`ALTER TABLE public.tenants VALIDATE CONSTRAINT tenants_${col}_http;`);
  });

  it("画面の保存は、空なら NULL にする（CHECK に落ちない）", () => {
    const settings = readFileSync("src/components/trainer/TrainerGymSettings.tsx", "utf8");
    expect(settings).toContain(".update({ line_url: url || null })");
    expect(settings).toContain(".update({ google_review_url: url || null } as any)");
  });
});

describe("DB: LINE ID は画面からは消す（連携の解除）ことしかできない", () => {
  const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.guard_profile_line_user_id()");
  const fn = sql.slice(at, sql.indexOf("$$;", at));

  it("🔴 SECURITY INVOKER で、画面から（authenticated / anon）の値の設定・変更を拒む", () => {
    expect(at).toBeGreaterThan(-1);
    expect(fn).not.toContain("SECURITY DEFINER");
    expect(fn).toContain("IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;");
    expect(fn).toContain("IF NEW.line_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.line_user_id IS DISTINCT FROM OLD.line_user_id) THEN");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF line_user_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_line_user_id();");
  });

  it("アプリが LINE ID に書くのは NULL（解除）だけ・値を入れるのは line-login-callback（service_role）", () => {
    for (const f of ["src/components/customer/CustomerSettings.tsx", "src/components/trainer/TrainerNotificationSettings.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain(".update({ line_user_id: null })");
    }
    const cb = readFileSync("supabase/functions/line-login-callback/index.ts", "utf8");
    expect(cb).toContain(".update({ line_user_id: lineUserId })");
    expect(cb).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
