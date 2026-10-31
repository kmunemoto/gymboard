/**
 * お客様が、同じジムの他のお客様のメンバー情報を読めない（2026-10-31・穴10）。
 * `supabase/migrations/20261031020000_tenant_members_customer_privacy.sql`
 *
 * 宗本さん「セキュリティを強化したい。個人情報が抜かれるのを恐れてます」。
 * 本番でお客様を演じたら、tenant_members が同じジムの他のお客様49人の行
 * （名前・プラン・残り回数・休会/退会の日付と理由）を返していた。
 *
 * 🔴 壊しやすいもの:
 *   1. 後のマイグレーションが「メンバーなら誰でも読める」ポリシーを作り直す
 *   2. スタッフの行まで隠して、お客様の予約・チャットから担当の名前が消える
 *   3. お客様の画面が、他のお客様の行を前提にした読み方を足す（RLS で黙って空になる）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (src: string) => stripSql(src).replace(/\s+/g, " ").trim();
const MIGRATION = "20261031020000_tenant_members_customer_privacy.sql";
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();

describe("DB: tenant_members の読み取り", () => {
  it("「メンバーなら誰でも全員の行を読める」ポリシーを消す", () => {
    expect(SQL).toContain('DROP POLICY IF EXISTS "Members can view same tenant members" ON public.tenant_members;');
  });

  it("お客様はスタッフの行だけ、スタッフ（インストラクターを含む）は全員の行", () => {
    expect(SQL).toContain(
      'CREATE POLICY "Customers see staff, staff see members" ON public.tenant_members FOR SELECT TO authenticated ' +
      "USING ( public.is_tenant_member(tenant_id, auth.uid()) AND ( role IN ('owner', 'trainer') " +
      "OR public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner', 'trainer']) ) );",
    );
  });

  it("🔴 後のマイグレーションが、メンバーなら誰でも読めるポリシーを作り直していない", () => {
    for (const f of files.filter((x) => x > MIGRATION)) {
      const s = norm(read(`supabase/migrations/${f}`));
      expect(s, f).not.toContain('CREATE POLICY "Members can view same tenant members"');
      for (const m of s.matchAll(/CREATE POLICY "[^"]+" ON public\.tenant_members FOR (?:SELECT|ALL)[^;]*;/g)) {
        if (!m[0].includes("is_tenant_member")) continue;
        expect(m[0], `${f}: お客様をスタッフの行に絞っていない`).toMatch(/has_tenant_role|role IN/);
      }
    }
  });

  it("security/check.sql に同じ穴の検査がある（兄弟アプリが自分の DB で調べられる）", () => {
    const kit = read("security/check.sql");
    expect(kit).toContain("検査8: お客様が、同じジムの他のお客様のメンバー行を読めないか");
    expect(kit.indexOf("検査8")).toBeLessThan(kit.indexOf("-- 検査7: cron の POST 先"));
  });
});

describe("お客様の画面が読む tenant_members は、自分の行かスタッフの行だけ", () => {
  // お客様のログインでも通る読み方。ここに無い読み方を足すと、新しいポリシーでは黙って空になる
  const chain = (path: string, at: number) => read(path).slice(at, at + 400);
  const readers = (path: string) =>
    [...read(path).matchAll(/\.from\("tenant_members"\)/g)].map((m) => chain(path, m.index ?? 0));

  it.each([
    "src/lib/tenantHelper.ts",
    "src/lib/tenantStaff.ts",
    "src/lib/tenantLookup.ts",
    "src/hooks/useTenant.ts",
    "src/pages/Index.tsx",
    "src/pages/JoinGym.tsx",
    "src/pages/Onboarding.tsx",
  ])("%s", (path) => {
    const found = readers(path);
    expect(found.length).toBeGreaterThan(0);
    for (const c of found) {
      const own = /\.eq\("user_id",/.test(c);
      const staff = /\.in\("role", \[\s*"(?:owner|trainer)", "(?:owner|trainer)"\s*\]\)/.test(c);
      const write = /\.(upsert|insert|update)\(/.test(c.slice(0, 120));
      expect(own || staff || write, c.slice(0, 200)).toBe(true);
    }
  });

  it("お客様の画面のコンポーネントは tenant_members を直接読まない", () => {
    const dir = "src/components/customer";
    for (const f of readdirSync(dir).filter((x) => /\.tsx?$/.test(x))) {
      expect(read(`${dir}/${f}`), f).not.toContain('.from("tenant_members")');
    }
  });
});
