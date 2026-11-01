/**
 * 所属の判定と、ジムの人数・上限を、関係の無い人には答えない（2026-11-01・点検の拡大 membership-oracle-1・tenant-limit-status-1）。
 *   `supabase/migrations/20261101110000_membership_answers_scoped.sql`
 *
 * 本番で、適用前は「他のジムのオーナーが、こちらのお客様の在籍・退会・役割と、ジムの人数・上限を確かめられる」
 * 「チャットのエラーの違いからも分かる」「お客様が同じジムの他のお客様の在籍を確かめられる」、
 * 適用後はどれも false / NULL / 同じエラーになり、お客様・オーナー・インストラクター・他のジムのオーナーが画面で読む件数は
 * 前後で同じ（同じトランザクションで比べた）ことを確かめた（mem/ops/tenant-boundary.md 穴30）。
 *
 * 🔴 壊しやすいもの:
 *   1. EXECUTE を剥がす → RLS と門番のトリガーが 42501 で全部落ちる（検査5-c）
 *   2. 「本人だけ」に絞る → スタッフが代理で予約・チャットできなくなる
 *   3. has_tenant_role のスタッフの問いにも確かめを足す → RLS で1行ごとに呼ばれるので重くなる（答えは変わらないのに）
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const FILE = "20261101110000_membership_answers_scoped.sql";
const norm = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ").trim();
const SQL = norm(readFileSync(`supabase/migrations/${FILE}`, "utf8"));
const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();

/** 関数の定義（ヘッダから $function$; まで） */
const defOf = (name: string) => {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} の定義が無い`).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$function$;", start) + "$function$;".length);
};

const FUNCS = ["_may_see_membership", "is_tenant_member", "is_tenant_member_any_status", "has_tenant_role", "has_role", "get_tenant_limit_status"];

describe("所属の判定は、関係の無い人に本当の答えを返さない", () => {
  it.each(FUNCS)("%s: この定義が最新（後のマイグレーションで上書きされていない）", (name) => {
    const defining = files.filter((f) =>
      new RegExp(`FUNCTION public\\.${name}\\(`).test(readFileSync(`supabase/migrations/${f}`, "utf8")),
    );
    expect(defining.at(-1)).toBe(FILE);
  });

  it("_may_see_membership: 本人・サーバー・そのジムの在籍中のスタッフ（呼んだ人か、聞かれた人）だけ", () => {
    const def = defOf("_may_see_membership");
    expect(def).toContain("STABLE SECURITY DEFINER SET search_path TO 'public'");
    expect(def).toContain("WHEN p_user_id = auth.uid() THEN true");
    expect(def).toContain("WHEN auth.uid() IS NULL THEN true");
    expect(def).toContain("s.user_id IN (auth.uid(), p_user_id)");
    expect(def).toContain("s.role IN ('owner', 'trainer')");
    expect(def).toContain("s.status = 'active'");
    // 画面から直接は呼ばせない（中の関数は所有者の権限で呼ぶので要らない）
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public._may_see_membership(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;",
    );
  });

  it.each(["is_tenant_member", "is_tenant_member_any_status"])("🔴 %s は答える前に確かめる", (name) => {
    const def = defOf(name);
    expect(def).toMatch(/public\._may_see_membership\((_tenant_id, _user_id|p_tenant_id, p_user_id)\)/);
    expect(def).toContain("STABLE SECURITY DEFINER");
  });

  it("is_tenant_member_any_status: 在籍の状態は今まで通り問わない（退会したお客様への連絡・過去の予約を止めない）", () => {
    const def = defOf("is_tenant_member_any_status");
    expect(def).toContain("m.tenant_id = p_tenant_id AND m.user_id = p_user_id");
    expect(def.slice(def.indexOf(" AS "))).not.toMatch(/\bstatus\b/);
  });

  it("🔴 has_tenant_role: スタッフの役割だけを聞くときは確かめない（RLS で1行ごとに呼ばれる・答えは変わらない）", () => {
    const def = defOf("has_tenant_role");
    expect(def).toContain(
      "WHEN _roles <@ ARRAY['owner', 'trainer']::text[] OR public._may_see_membership(_tenant_id, _user_id) THEN EXISTS (",
    );
    expect(def).toContain("ELSE false END");
  });

  it("has_role: 本人とサーバーにだけ答える", () => {
    expect(defOf("has_role")).toContain("WHEN _user_id = auth.uid() OR auth.uid() IS NULL THEN EXISTS (");
  });

  it("is_limited_staff は変えない（聞かれた人がインストラクターかしか答えない）", () => {
    expect(SQL).not.toContain("FUNCTION public.is_limited_staff(");
  });

  it("🔴 EXECUTE は剥がさない（RLS と門番のトリガーが authenticated の権限で呼ぶ）", () => {
    for (const fn of ["is_tenant_member", "is_tenant_member_any_status", "has_tenant_role", "has_role"]) {
      expect(SQL, fn).not.toMatch(new RegExp(`REVOKE[^;]*FUNCTION public\\.${fn}\\(`));
    }
  });
});

describe("ジムの人数・上限は、そのジムの人にだけ返す", () => {
  it("get_tenant_limit_status: 在籍していなければ NULL（サーバーは今まで通り）", () => {
    const def = defOf("get_tenant_limit_status");
    const guard = def.indexOf("IF auth.uid() IS NOT NULL AND NOT public.is_tenant_member(p_tenant_id, auth.uid()) THEN RETURN NULL; END IF;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(def.indexOf("FROM public.tenants"));
  });

  it("画面は自分のジムの id だけを渡し、NULL なら何も出さない", () => {
    const hook = readFileSync("src/hooks/useTenantLimit.ts", "utf8");
    expect(hook).toContain('supabase.rpc("get_tenant_limit_status"');
  });

  it("is_tenant_over_limit は anon から外す（authenticated は残す）", () => {
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION public.is_tenant_over_limit(uuid) FROM PUBLIC, anon;");
    expect(SQL).not.toMatch(/REVOKE[^;]*is_tenant_over_limit[^;]*authenticated/);
  });
});
