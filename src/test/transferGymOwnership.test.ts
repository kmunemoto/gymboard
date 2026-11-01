/**
 * オーナーを引き継いでも、ジムの持ち主（tenants.owner_user_id）が元のオーナーのままだった穴
 * （2026-11-01・点検の拡大 transfer-gym-ownership-1）。
 *   `supabase/migrations/20261101060000_transfer_ownership_updates_owner.sql`
 *
 * owner_user_id で「オーナーか」を見ている所が多い（tenants の更新・インストラクターの招待コード・インストラクターを外す・
 * tenant_members の INSERT ポリシーの owner の枝）。引き継いでもこれが元オーナーのままだと、元オーナーが設定を変え続けられ、
 * 新オーナーに外されても owner として入れ直せた（全お客様の情報が見える）。
 *
 * 本番で、適用前は「引き継いだ後も持ち主は元オーナー・元オーナーは招待コードを取れる・外されても owner で戻れる」、
 * 適用後は「持ち主は新オーナー・元オーナーはコードを取れない・戻れない（42501）」を確かめた（mem/ops/tenant-boundary.md 穴23）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const norm = (s: string) => stripSql(s).replace(/\s+/g, " ").trim();

const MIGRATION = "20261101060000_transfer_ownership_updates_owner.sql";
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
const SQL = norm(read(`supabase/migrations/${MIGRATION}`));
const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.transfer_gym_ownership("));

describe("transfer_gym_ownership（20261101060000）", () => {
  it("これが最新の定義", () => {
    const last = [...migrations].reverse().find((f) => norm(read(`supabase/migrations/${f}`)).includes("CREATE OR REPLACE FUNCTION public.transfer_gym_ownership("));
    expect(last).toBe(MIGRATION);
  });

  it("🔴 役割を入れ替えたあと、ジムの持ち主（owner_user_id）も新オーナーにする", () => {
    const swapAt = fn.indexOf("UPDATE public.tenant_members SET role='trainer', staff_access='limited' WHERE tenant_id = v_tenant_id AND user_id = v_uid;");
    const ownerAt = fn.indexOf("UPDATE public.tenants SET owner_user_id = _to_user_id WHERE id = v_tenant_id;");
    expect(swapAt).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(swapAt);
  });

  it("今までの守り（オーナーだけ・同じジムのインストラクターにだけ・曖昧なら落とす・ガードの合図）はそのまま", () => {
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'");
    expect(fn).toContain("IF v_owned = 0 THEN RAISE EXCEPTION 'not_owner'");
    expect(fn).toContain("IF v_owned > 1 THEN RAISE EXCEPTION 'ambiguous_tenant:%'");
    expect(fn).toContain("IF _to_user_id = v_uid THEN RAISE EXCEPTION 'same_user'");
    expect(fn).toContain("AND role = 'trainer' AND status = 'active'; IF NOT FOUND THEN RAISE EXCEPTION 'target_not_staff'");
    expect(fn).toContain("UPDATE public.tenant_members SET role='owner', staff_access='full' WHERE tenant_id = v_tenant_id AND user_id = _to_user_id;");
    expect(fn).toContain("PERFORM set_config('app.owner_transfer', '1', true);");
    expect(fn).toContain("PERFORM set_config('app.owner_transfer', '', true);");
    expect(fn).toContain("VALUES (_to_user_id, 'trainer'::app_role) ON CONFLICT DO NOTHING;");
    // 引数は変えない（古いアプリがそのまま呼べる）
    expect(fn).toMatch(/^CREATE OR REPLACE FUNCTION public\.transfer_gym_ownership\(_to_user_id uuid\) RETURNS void/);
  });

  it("tenants の門番は SECURITY INVOKER のまま（DEFINER の中の更新は current_user=postgres で通る）", () => {
    const guardFile = [...migrations].reverse().find((f) => norm(read(`supabase/migrations/${f}`)).includes("CREATE OR REPLACE FUNCTION public.guard_tenant_billing_columns("));
    expect(guardFile).toBeTruthy();
    const g = norm(read(`supabase/migrations/${guardFile!}`));
    const body = g.slice(g.indexOf("CREATE OR REPLACE FUNCTION public.guard_tenant_billing_columns("));
    expect(body.slice(0, body.indexOf("BEGIN"))).not.toContain("SECURITY DEFINER");
    expect(body).toContain("current_user NOT IN ('authenticated', 'anon')");
  });
});
