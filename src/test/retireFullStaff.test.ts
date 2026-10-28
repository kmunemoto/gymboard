/**
 * 「スタッフ」（staff_access = 'full' の trainer）をなくした（2026-10-28）。
 *
 * 宗本さん「スタッフいらない」→ 全部のジムで。ジム側の人はオーナーとインストラクター（limited）だけ。
 * `supabase/migrations/20261028050000_retire_full_staff.sql`
 *
 * 🔴 壊しやすいもの:
 *   1. スタッフ用の招待コードで参加できてしまう（スクリーンショットに写ったコードなど）
 *   2. trainer が full になれる（古いアプリの切り替え・参加し直し）
 *   3. オーナーの引き継ぎで、新オーナーが limited のまま → 店宛ての通知の宛先（`.neq("staff_access", "limited")`）から漏れる
 *   4. 元オーナーが full の trainer になろうとして CHECK に当たり、引き継ぎそのものが失敗する
 *   5. 後のマイグレーションが、スタッフ用のコードを受け付ける定義に戻す
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripSql = (src: string) => src.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const MIGRATION = "20261028050000_retire_full_staff.sql";
const SQL = stripSql(read(`supabase/migrations/${MIGRATION}`));

/** 関数の定義（CREATE OR REPLACE から $function$; まで） */
const fnBody = (name: string) => {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} の定義が見つからない`).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf("$function$;", start));
};

describe("スタッフ用の招待コード", () => {
  it("🔴 今あるスタッフ用のコードは捨て、二度と入らない（列は残す）", () => {
    expect(SQL).toContain("UPDATE public.tenant_staff_invites SET staff_code = NULL, updated_at = now() WHERE staff_code IS NOT NULL;");
    expect(SQL).toMatch(/ADD CONSTRAINT tenant_staff_invites_no_staff_code CHECK \(staff_code IS NULL\)/);
  });

  it("オーナーのスタッフ用コードの RPC: 取得は NULL（古いアプリは画面ごと出さない）、作り直しは断る", () => {
    const fn = fnBody("_owner_staff_invite_code");
    const staffBranch = fn.slice(fn.indexOf("IF p_kind = 'staff' THEN"), fn.indexOf("IF auth.uid() IS NULL THEN"));
    expect(staffBranch).toMatch(/IF p_regenerate THEN\s*RAISE EXCEPTION 'スタッフの招待は終了しました/);
    expect(staffBranch).toContain("RETURN NULL;");
    // 作るのはインストラクター用だけ
    expect(fn).toContain("SELECT i.instructor_code");
    expect(fn).toContain("VALUES (v_tenant_id, NULL, v_code)");
    expect(fn).not.toMatch(/SET staff_code/);
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public._owner_staff_invite_code(text, boolean) FROM PUBLIC, anon, authenticated;");
  });

  it("🔴 照会（参加前の確認）はインストラクター用のコードだけ", () => {
    const fn = fnBody("lookup_tenant_by_staff_invite_code");
    expect(fn).toContain("WHERE lower(replace(trim(p_code), '-', '')) = i.instructor_code");
    expect(fn).not.toContain("staff_code");
  });

  it("🔴 参加はインストラクター用のコードだけ。参加した人（参加し直しも）は必ず limited", () => {
    const fn = fnBody("join_tenant_as_staff_with_invite_code");
    expect(fn).toContain("v_access text := 'limited';");
    expect(fn).toContain("AND v_code = i.instructor_code");
    expect(fn).not.toContain("staff_code");
    expect(fn).not.toMatch(/'full'/);
    expect(fn).toContain("SET status = 'active', display_name = v_name, staff_access = v_access");
    expect(fn).toContain("VALUES (v_tenant_id, v_uid, 'trainer', v_name, 'active', v_access);");
    // 引数に user_id / role を取らない（取ると他人の行の作成・owner への昇格に使える）
    expect(fn.slice(0, 200)).not.toMatch(/p_user_id|p_role/);
  });

  it("照会・参加は anon から呼べない（ログインした人だけ）", () => {
    for (const fn of ["lookup_tenant_by_staff_invite_code(text)", "join_tenant_as_staff_with_invite_code(text, text)"]) {
      expect(SQL, fn).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon;`);
      expect(SQL, fn).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated;`);
    }
  });
});

describe("trainer は必ずインストラクター", () => {
  it("🔴 CHECK で、full の trainer を作れない（古いアプリの切り替えでも）", () => {
    expect(SQL).toMatch(
      /ADD CONSTRAINT tenant_members_trainer_is_instructor CHECK \(role <> 'trainer' OR staff_access = 'limited'\)/,
    );
  });
});

describe("オーナーの引き継ぎ（transfer_gym_ownership）", () => {
  const fn = () => fnBody("transfer_gym_ownership");

  it("🔴 新オーナーは full、元オーナーは limited のインストラクターになる", () => {
    expect(fn()).toMatch(/SET role='owner', staff_access='full'\s*\n\s*WHERE tenant_id = v_tenant_id AND user_id = _to_user_id;/);
    expect(fn()).toMatch(/SET role='trainer', staff_access='limited'\s*\n\s*WHERE tenant_id = v_tenant_id AND user_id = v_uid;/);
  });

  it("今までの守り（オーナーだけ・同じジムの trainer にだけ・曖昧なら落とす・ガードの合図）はそのまま", () => {
    const body = fn();
    expect(body).toContain("SECURITY DEFINER");
    expect(body).toContain("'not_owner'");
    expect(body).toContain("IF v_owned > 1 THEN RAISE EXCEPTION 'ambiguous_tenant:%'");
    expect(body).toMatch(/AND role = 'trainer' AND status = 'active';\s*\n\s*IF NOT FOUND THEN RAISE EXCEPTION 'target_not_staff'/);
    expect(body).toContain("PERFORM set_config('app.owner_transfer', '1', true);");
    expect(body).toContain("PERFORM set_config('app.owner_transfer', '', true);");
    expect(body).toContain("VALUES (_to_user_id, 'trainer'::app_role) ON CONFLICT DO NOTHING;");
  });
});

describe("🔴 後のマイグレーションが戻していない（最後の定義はこのマイグレーション）", () => {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  it.each([
    "_owner_staff_invite_code", "lookup_tenant_by_staff_invite_code",
    "join_tenant_as_staff_with_invite_code", "transfer_gym_ownership",
  ])("%s", (name) => {
    const last = files.filter((f) => stripSql(read(`supabase/migrations/${f}`)).includes(`CREATE OR REPLACE FUNCTION public.${name}(`)).pop();
    expect(last).toBe(MIGRATION);
  });
});

describe("画面", () => {
  it("スタッフ管理はスタッフ用のコードを読まない・切り替えスイッチを持たない", () => {
    const src = read("src/components/trainer/TrainerStaffManager.tsx");
    expect(src).not.toContain("get_my_staff_invite_code");
    expect(src).not.toContain("regenerate_staff_invite_code");
    expect(src).not.toContain("@/components/ui/switch");
    expect(src).toContain('supabase.rpc("get_my_instructor_invite_code")');
  });
});
