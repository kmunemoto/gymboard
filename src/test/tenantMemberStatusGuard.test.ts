/**
 * 退会したお客様を、元のジムのオーナーが API で「在籍」に戻せない・1人が在籍中にできるジムは1つ
 * （2026-11-11・定期点検 guard_tenant_member_identity-1 / tenant-members-reactivate-1）。
 *   `supabase/migrations/20261111020000_tenant_member_status_guard.sql`
 *
 * 戻すと、在籍中だけを通す RESTRICTIVE（shares_tenant_with_me）が開き、その人の共通のプロフィール・体の記録・写真を
 * また読める・消せた。別のジムで在籍中の人だと所属が2つになり、その人の「自分のジム」が切り替わりうった。
 * 本番で、オーナーとして退会したお客様を戻すと拒否・休会と再開・退会は今まで通り、を演じて確かめた（mem/ops/tenant-boundary.md 穴36）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const FILE = "20261111020000_tenant_member_status_guard.sql";
const norm = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ").trim();
const SQL = norm(readFileSync(`supabase/migrations/${FILE}`, "utf8"));
const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.guard_tenant_member_identity("), SQL.indexOf("$function$;") + 11);

describe("guard_tenant_member_identity: 退会・解約から戻せるのは本人とサーバーだけ", () => {
  it("この定義が最新（後のマイグレーションで上書きされていない）", () => {
    const defining = files.filter((f) =>
      /FUNCTION public\.guard_tenant_member_identity\(/.test(readFileSync(`supabase/migrations/${f}`, "utf8")),
    );
    expect(defining.at(-1)).toBe(FILE);
  });

  it("元の守り（user_id・tenant_id・role の変更を拒む・オーナーの引き継ぎだけ role を通す・サーバーは素通し）を残している", () => {
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("IF auth.uid() IS NULL THEN RETURN NEW; END IF;");
    expect(fn).toContain("IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN");
    expect(fn).toContain("IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN");
    expect(fn).toContain("IF NEW.role IS DISTINCT FROM OLD.role AND coalesce(current_setting('app.owner_transfer', true), '') <> '1' THEN");
  });

  it("🔴 (a) 退会・解約からほかの状態へは、本人以外は変えられない（休会からの再開は止めない）", () => {
    expect(fn).toContain(
      "IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status IN ('withdrawn', 'cancelled') AND auth.uid() IS DISTINCT FROM NEW.user_id THEN",
    );
    expect(fn).not.toMatch(/OLD\.status IN \([^)]*'suspended'/);
  });

  it("🔴 (b) 他のジムで在籍中の人は在籍にできない（理由は出さない）", () => {
    expect(fn).toContain(
      "IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' AND EXISTS ( SELECT 1 FROM public.tenant_members o WHERE o.user_id = NEW.user_id AND o.tenant_id <> NEW.tenant_id AND o.status = 'active' ) THEN",
    );
    expect(fn).toContain("RAISE EXCEPTION 'この方は在籍に戻せません'");
  });

  it("🔴 1人が在籍中にできるジムは1つ（部分一意索引。INSERT の経路も止める）", () => {
    expect(SQL).toContain("CREATE UNIQUE INDEX IF NOT EXISTS tenant_members_one_active_per_user ON public.tenant_members (user_id) WHERE status = 'active';");
  });
});

describe("画面の操作は変わらない", () => {
  const card = readFileSync("src/components/trainer/clientDetail/MemberInfoCard.tsx", "utf8");

  it("退会した人には状態を変えるボタンを出さない（退会から戻す操作は、どの版のアプリにも無い）", () => {
    expect(card).toContain("!withdrawn && canManageStatus");
  });

  it("画面が書く状態は 休会・再開・退会 だけ", () => {
    const statuses = [...card.matchAll(/status: "(\w+)"/g)].map((m) => m[1]);
    expect(new Set(statuses)).toEqual(new Set(["suspended", "active", "withdrawn"]));
  });

  it("参加（JoinGym）とジムの開設（Onboarding）は、既存の所属があれば止める（1人1ジム）", () => {
    const join = readFileSync("src/pages/JoinGym.tsx", "utf8");
    expect(join).toContain("setExistingMembership({ gym_name: gymName });");
    const onboarding = readFileSync("src/pages/Onboarding.tsx", "utf8");
    expect(onboarding).toMatch(/\.from\("tenant_members"\)\s*\.select\("id"\)\s*\.eq\("user_id", user\.id\)\s*\.limit\(1\)/);
  });
});
