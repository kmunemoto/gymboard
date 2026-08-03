import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { MIGRATIONS_DIR, effectivePolicies, stripSqlComments } from "./helpers/rlsPolicies";

// `tenant_members` は**テナント境界そのもの**なので、書き込みだけ別扱いで見張る。
//
// ── 何が起きていたか（2026-08-03 に発見） ──────────────────────────
//
//   CREATE POLICY "Trainers/owners can manage members" ON public.tenant_members FOR ALL
//     USING      (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']))
//     WITH CHECK (public.has_tenant_role(tenant_id, auth.uid(), ARRAY['owner','trainer']));
//
// WITH CHECK が見ているのは「**呼び出し元が**その tenant_id において owner/trainer か」
// だけで、**挿入される user_id には制約が無い**。つまりトレーナーは
//
//   supabase.from('tenant_members').insert({ tenant_id: '<自分の店>', user_id: '<他店の顧客>', ... })
//
// の1行で、他店の顧客を自分の店の顧客ということにできた。そうすると
// `shares_tenant_with_me()` が真になり、profiles / skeletal_diagnoses（施術記録）などの
// RESTRICTIVE なテナント境界が開く。`FOR ALL` なので DELETE で痕跡も消せた。
//
// ── なぜ tenantIsolation.test.ts では捕まらないのか ────────────────
// あちらは「**既存行**に触れるポリシー」を見る（`touchesExistingRows` が INSERT を除外する）。
// テナント境界を作る側＝INSERT は対象外なので、この穴は素通りしていた。
// **「読めるか」ではなく「境界を作れるか」を見るのが、このファイルの役目。**

const { policies } = effectivePolicies();
const memberPolicies = policies.filter((p) => p.table === "tenant_members");

const allMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8")))
  .join("\n");

/**
 * そのコマンドを許すポリシー。`FOR ALL` は INSERT / UPDATE / DELETE を
 * まとめて開けるので、どのコマンドの検査にも含める。
 * （これを忘れると「FOR ALL が復活したときに INSERT の検査だけ素通り」になる）
 */
const policiesFor = (cmd: "INSERT" | "UPDATE" | "DELETE") =>
  memberPolicies.filter((p) => p.cmd === cmd || p.cmd === "ALL");

/** そのポリシーが「自分の行だけ」を要求しているか */
const requiresOwnRow = (body: string) => /user_id\s*=\s*auth\.uid\(\)|auth\.uid\(\)\s*=\s*user_id/.test(body);

describe("tenant_members: 他人の所属を作れないこと", () => {
  it("解析器が tenant_members のポリシーを拾えている", () => {
    // 0件のまま緑になる（＝何も見ていない）事故を防ぐ
    expect(memberPolicies.length).toBeGreaterThanOrEqual(3);
  });

  it("FOR ALL のポリシーが残っていない", () => {
    // FOR ALL は INSERT / UPDATE / DELETE をまとめて開けてしまう。
    // コマンドごとに分けて、それぞれに必要な条件を書く。
    const forAll = memberPolicies.filter((p) => p.cmd === "ALL");
    expect(
      forAll.map((p) => p.name),
      "tenant_members に FOR ALL のポリシーがあります。INSERT/UPDATE/DELETE に分けてください",
    ).toEqual([]);
  });

  it("INSERT できるのは自分の行だけ", () => {
    const inserts = policiesFor("INSERT");
    expect(inserts.length).toBeGreaterThan(0);
    const offenders = inserts.filter((p) => !requiresOwnRow(p.body));
    expect(
      offenders.map((p) => `${p.name}: ${p.body.slice(0, 120)}`),
      "他人の user_id を tenant_members に入れられるポリシーがあります。" +
        "これが通ると、そのユーザーのテナント境界が攻撃者側に開きます",
    ).toEqual([]);
  });

  it("削除できるのは、そのテナントの owner だけ", () => {
    // trainer に DELETE を残すと、乗っ取りのあと所属行を消して痕跡を消せる
    const deletes = policiesFor("DELETE");
    for (const p of deletes) {
      // `auth.uid()` に閉じ括弧が含まれるので `[^)]*` では届かない
      expect(p.body, `${p.name} が owner 限定になっていない`).toMatch(
        /has_tenant_role\([\s\S]*?ARRAY\s*\[\s*'owner'\s*\]/,
      );
    }
  });

  it("UPDATE は自テナントの行に限られている（前後とも）", () => {
    const updates = policiesFor("UPDATE");
    expect(updates.length).toBeGreaterThan(0);
    for (const p of updates) {
      // USING（更新前）と WITH CHECK（更新後）の両方にテナント条件が要る。
      // WITH CHECK が無いと、自テナントの行を他テナントへ移せる。
      expect(p.body, `${p.name} の USING にテナント条件が無い`).toMatch(/USING\s*\(\s*public\.has_tenant_role\(/);
      expect(p.body, `${p.name} の WITH CHECK にテナント条件が無い`).toMatch(
        /WITH\s+CHECK\s*\(\s*public\.has_tenant_role\(/,
      );
    }
  });
});

describe("tenant_members: 行の同一性を UPDATE で書き換えられないこと", () => {
  // RLS の WITH CHECK は「更新後の行」しか見えない。旧値と比較できないので、
  // 「自テナントの既存行の user_id を被害者のものに差し替える」はポリシーでは塞げない。
  // BEFORE UPDATE トリガーで塞いでいる。

  it("guard_tenant_member_identity 関数がある", () => {
    expect(allMigrations).toMatch(
      /CREATE OR REPLACE FUNCTION public\.guard_tenant_member_identity\(\)/,
    );
  });

  it("user_id / tenant_id / role の変更をすべて弾いている", () => {
    const fn = /CREATE OR REPLACE FUNCTION public\.guard_tenant_member_identity\(\)[\s\S]*?\$\$;/.exec(
      allMigrations,
    )?.[0];
    expect(fn, "関数本体を取り出せていない").toBeTruthy();
    for (const col of ["user_id", "tenant_id", "role"]) {
      expect(fn!, `${col} の変更が弾かれていない`).toMatch(
        new RegExp(`NEW\\.${col} IS DISTINCT FROM OLD\\.${col}`),
      );
    }
    // 弾く側が RAISE EXCEPTION であること（黙って握り潰さない）
    expect((fn!.match(/RAISE EXCEPTION/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("service_role / マイグレーションは対象外になっている", () => {
    // auth.uid() が NULL の経路（service_role・ダッシュボード・マイグレーション）まで
    // 止めると、運用上の付け替えができなくなる
    const fn = /CREATE OR REPLACE FUNCTION public\.guard_tenant_member_identity\(\)[\s\S]*?\$\$;/.exec(
      allMigrations,
    )?.[0];
    expect(fn!).toMatch(/IF auth\.uid\(\) IS NULL THEN\s*RETURN NEW;/);
  });

  it("BEFORE UPDATE トリガーとして張られている", () => {
    expect(allMigrations).toMatch(
      /CREATE TRIGGER trg_guard_tenant_member_identity\s+BEFORE UPDATE ON public\.tenant_members/,
    );
  });
});
