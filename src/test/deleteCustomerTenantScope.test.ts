/**
 * お客様の削除（delete_customer_cascade）が、他のジムの記録と共通のプロフィールまで消していた穴
 * （2026-11-01・点検の拡大 delete-customer-cascade-1）。
 *   `supabase/migrations/20261101100000_delete_customer_tenant_scope.sql`
 *
 * 本番で、適用前は「オーナーが削除すると、そのお客様のもう1つのジムのチャット・予約・記録と、プロフィール・印まで消える」、
 * 適用後は「自分のジムの分だけ消え、もう1つのジムの記録・プロフィール・印は残り、自分のジムの所属だけ外れる」を確かめた。
 * 1つのジムだけのお客様・本人・service_role・インストラクター・関係の無いオーナーの結果は、前と同じ（mem/ops/tenant-boundary.md 穴29）。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

const FILE = "20261101100000_delete_customer_tenant_scope.sql";
const sql = readFileSync(`supabase/migrations/${FILE}`, "utf8")
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ");
const at = sql.indexOf("CREATE OR REPLACE FUNCTION public.delete_customer_cascade(_customer_id uuid)");
const fn = sql.slice(at, sql.indexOf("$function$;", at));
const ownerAt = fn.indexOf("SELECT array_agg(DISTINCT me.tenant_id) INTO v_tenants");
const ownerPath = fn.slice(ownerAt);
const SHARED = ["notification_settings", "profiles", "user_roles"];

describe("delete_customer_cascade: オーナーは自分のジムの記録だけを消す", () => {
  it("この定義が最新（後のマイグレーションで上書きされていない）", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    const defining = files.filter((f) =>
      /FUNCTION public\.delete_customer_cascade\(/.test(readFileSync(`supabase/migrations/${f}`, "utf8")),
    );
    expect(defining.at(-1)).toBe(FILE);
  });

  it("呼べる人は前と同じ（assert_can_act_for・インストラクターは断る・anon は呼べない）", () => {
    expect(at).toBeGreaterThan(-1);
    expect(ownerAt).toBeGreaterThan(-1);
    expect(fn).toContain("SECURITY DEFINER SET search_path TO 'public'");
    expect(fn).toContain("BEGIN PERFORM public.assert_can_act_for(_customer_id);");
    expect(fn).toContain("v_uid IS DISTINCT FROM _customer_id");
    expect(fn).toContain("me.staff_access = 'limited'");
    // 未ログイン（NULL）で素通りする比較を使っていない（rpcCallerCheck.test.ts と同じ理由）
    expect(fn).not.toMatch(/(auth\.uid\(\)|v_uid)\s*(<>|!=)/);
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.delete_customer_cascade(uuid) FROM PUBLIC, anon;");
  });

  it("本人（退会）・service_role は、前と同じく全部消す", () => {
    const selfAt = fn.indexOf("IF v_uid IS NULL OR v_uid = _customer_id THEN");
    expect(selfAt).toBeGreaterThan(-1);
    expect(selfAt).toBeLessThan(ownerAt);
    const selfPath = fn.slice(selfAt, fn.indexOf("RETURN; END IF;", selfAt));
    for (const t of ["workouts", "bookings", "meals", ...SHARED]) {
      expect(selfPath, t).toContain(`DELETE FROM public.${t} WHERE user_id = _customer_id;`);
    }
    expect(selfPath).toContain("DELETE FROM public.messages WHERE sender_id = _customer_id OR receiver_id = _customer_id;");
  });

  it("🔴 消すジムは「自分がオーナーとして在籍し、その人の所属の行がある」ジムだけ", () => {
    expect(ownerPath).toContain("ON target.tenant_id = me.tenant_id AND target.user_id = _customer_id");
    expect(ownerPath).toContain("WHERE me.user_id = v_uid AND me.status = 'active' AND me.role = 'owner';");
    expect(ownerPath).toMatch(/IF v_tenants IS NULL THEN RAISE EXCEPTION '[^']+' USING ERRCODE = '42501';/);
  });

  it.each(["workouts", "bookings", "meals"])("🔴 %s は tenant_id で絞って消す", (t) => {
    expect(ownerPath).toContain(
      `DELETE FROM public.${t} WHERE user_id = _customer_id AND (tenant_id = ANY (v_tenants) OR (v_only_here AND tenant_id IS NULL));`,
    );
  });

  it("🔴 チャットも tenant_id で絞って消す（相手が送った分も、そのジムの分だけ）", () => {
    expect(ownerPath).toContain(
      "DELETE FROM public.messages WHERE (sender_id = _customer_id OR receiver_id = _customer_id) AND (tenant_id = ANY (v_tenants) OR (v_only_here AND tenant_id IS NULL));",
    );
  });

  it("オーナーの経路に、ジムで絞らない記録の DELETE が無い", () => {
    const deletes = [...ownerPath.matchAll(/DELETE FROM public\.(\w+) WHERE ([^;]*);/g)];
    expect(deletes.map((m) => m[1]).sort()).toEqual(
      ["bookings", "meals", "messages", "notification_settings", "profiles", "tenant_members", "user_roles", "workouts"],
    );
    for (const [, table, where] of deletes) {
      if (SHARED.includes(table)) continue; // 共通の行は下の v_only_here の中だけ
      expect(where, table).toMatch(/tenant_id = ANY \(v_tenants\)/);
    }
  });

  it("🔴 共通の行（プロフィール・通知の設定・印）は、他のジムに所属の行（状態を問わない）が無いときだけ消す", () => {
    expect(ownerPath).toContain(
      "v_only_here := NOT EXISTS ( SELECT 1 FROM public.tenant_members o WHERE o.user_id = _customer_id AND NOT (o.tenant_id = ANY (v_tenants)) );",
    );
    const onlyHereAt = ownerPath.indexOf("IF v_only_here THEN");
    const elseAt = ownerPath.indexOf(" ELSE ", onlyHereAt);
    expect(onlyHereAt).toBeGreaterThan(-1);
    const onlyHere = ownerPath.slice(onlyHereAt, elseAt);
    for (const t of SHARED) {
      expect(onlyHere, t).toContain(`DELETE FROM public.${t} WHERE user_id = _customer_id;`);
      expect(ownerPath.split(`DELETE FROM public.${t} `).length - 1, t).toBe(1);
    }
  });

  it("他のジムにも所属がある人は、共通の行を残して、自分のジムのお客様としての所属だけを外す", () => {
    expect(ownerPath).toContain(
      "ELSE DELETE FROM public.tenant_members WHERE user_id = _customer_id AND tenant_id = ANY (v_tenants) AND role = 'customer'; END IF;",
    );
  });
});

describe("画面の呼び方は変えない", () => {
  it("顧客一覧は今まで通り _customer_id だけを渡す（古いアプリも同じ）", () => {
    const list = readFileSync("src/components/trainer/TrainerClientList.tsx", "utf8");
    expect(list).toContain('supabase.rpc("delete_customer_cascade", { _customer_id: deleteTarget })');
  });
});
