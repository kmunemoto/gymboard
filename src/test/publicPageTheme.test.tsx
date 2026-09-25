/**
 * 公開の予約ページ（体験・ドロップイン）の色をジムごとに固定する（2026-09-25）。
 *
 * 宗本さん「私のジムの体験予約ページの色はオレンジ変えてティファニーブルーに固定して」。
 * ページは見ている端末のテーマカラーで描かれていたので、テーマカラーをオレンジにした
 * 端末ではオレンジに見えていた。
 *
 * 🔴 壊しやすいもの:
 *   1. 設定していないジムまで色を変える（NULL は今まで通り＝何もしない）
 *   2. ページを離れても固定色が残る（同じタブでアプリに戻ると、その人の設定が消えて見える）
 *   3. 返り値に列を足すときに GRANT を貼り直し忘れる（未ログインの予約ページが丸ごと壊れる）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { usePublicPageTheme, resolvePublicThemePreset } from "@/hooks/usePublicPageTheme";
import { THEME_COLORS } from "@/lib/themeColor";

const root = document.documentElement;
const AMBER = THEME_COLORS.find((p) => p.id === "amber-vivid")!;
const TEAL = THEME_COLORS.find((p) => p.id === "teal-soft")!;

const Page = ({ themeId }: { themeId: string | null | undefined }) => {
  usePublicPageTheme(themeId);
  return null;
};

/** 端末でテーマカラーをオレンジ・すりガラス・背景写真にしている状態 */
const deviceWithOrangeTheme = () => {
  Object.entries(AMBER.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.classList.add("theme-glass", "theme-photo");
};

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

beforeEach(() => {
  root.removeAttribute("style");
  root.className = "";
});

describe("usePublicPageTheme", () => {
  it("固定色があれば、端末のテーマカラー（オレンジ）より優先する。すりガラス・背景写真も外す", () => {
    deviceWithOrangeTheme();
    render(<Page themeId="teal-soft" />);
    expect(root.style.getPropertyValue("--accent")).toBe(TEAL.vars["--accent"]);
    expect(root.style.getPropertyValue("--primary")).toBe(TEAL.vars["--primary"]);
    expect(root.classList.contains("theme-glass")).toBe(false);
    expect(root.classList.contains("theme-photo")).toBe(false);
  });

  it("🔴 ページを離れたら、その人の設定（オレンジ・すりガラス・背景写真）に戻す", () => {
    deviceWithOrangeTheme();
    const { unmount } = render(<Page themeId="teal-soft" />);
    unmount();
    expect(root.style.getPropertyValue("--accent")).toBe(AMBER.vars["--accent"]);
    expect(root.style.getPropertyValue("--primary")).toBe(AMBER.vars["--primary"]);
    expect(root.classList.contains("theme-glass")).toBe(true);
    expect(root.classList.contains("theme-photo")).toBe(true);
  });

  it("端末に設定が無ければ、離れたあとも何も残さない（既定の色に戻る）", () => {
    const { unmount } = render(<Page themeId="teal-soft" />);
    unmount();
    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(root.classList.length).toBe(0);
  });

  it("🔴 未設定（null）・知らない値なら何もしない＝今まで通り", () => {
    for (const id of [null, undefined, "", "no-such-color", "purple-soft"]) {
      deviceWithOrangeTheme();
      const { unmount } = render(<Page themeId={id} />);
      expect(root.style.getPropertyValue("--accent"), String(id)).toBe(AMBER.vars["--accent"]);
      expect(root.classList.contains("theme-glass"), String(id)).toBe(true);
      unmount();
    }
  });

  it("6色だったころの id（\"teal\"）も読める", () => {
    expect(resolvePublicThemePreset("teal")?.id).toBe("teal-soft");
    expect(resolvePublicThemePreset("teal-soft")?.id).toBe("teal-soft");
  });
});

describe("配線", () => {
  for (const page of ["src/pages/TrialBooking.tsx", "src/pages/DropInBooking.tsx"]) {
    it(`${page} がジムの固定色を使う`, () => {
      const src = stripComments(readFileSync(page, "utf8"));
      expect(src).toContain("usePublicPageTheme(tenant?.public_theme_color)");
      expect(src).toMatch(/public_theme_color: string \| null;/);
    });
  }
});

describe("🔴 DB（マイグレーション）", () => {
  const MIG = readFileSync("supabase/migrations/20260925010000_public_page_theme.sql", "utf8");
  const sql = MIG.replace(/--[^\n]*/g, "");

  it("列と、形の CHECK を足している", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS public_theme_color text/);
    expect(sql).toMatch(/CHECK \(public_theme_color IS NULL OR public_theme_color ~/);
  });

  it("CHECK の形は、64色の id をすべて受ける", () => {
    const m = /public_theme_color ~ '([^']+)'/.exec(sql);
    expect(m).toBeTruthy();
    const re = new RegExp(m![1]);
    for (const p of THEME_COLORS) expect(re.test(p.id), p.id).toBe(true);
    expect(re.test("teal")).toBe(false);
    expect(re.test("TEAL-soft")).toBe(false);
  });

  it("get_tenant_public が返し、DROP のあとに未ログインへの GRANT を貼り直している", () => {
    const create = sql.indexOf("CREATE OR REPLACE FUNCTION public.get_tenant_public");
    const returns = sql.slice(create, sql.indexOf("LANGUAGE sql", create));
    expect(returns).toContain("public_theme_color text");
    expect(sql.slice(create)).toContain("t.public_theme_color");
    const drop = sql.indexOf("DROP FUNCTION IF EXISTS public.get_tenant_public(uuid)");
    const grant = sql.indexOf("GRANT EXECUTE ON FUNCTION public.get_tenant_public(uuid) TO anon");
    expect(drop).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(create);
  });

  it("このマイグレーションが get_tenant_public の最後の定義（後から古い形で上書きされていない）", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    const last = files.filter((f) =>
      /CREATE OR REPLACE FUNCTION public\.get_tenant_public\(/.test(readFileSync(`supabase/migrations/${f}`, "utf8")),
    ).pop();
    expect(last).toBe("20260925010000_public_page_theme.sql");
  });

  it("特定のジムの値はマイグレーションに書かない（リポジトリは public）", () => {
    expect(MIG).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(sql).not.toMatch(/UPDATE\s+public\.tenants/i);
  });
});
