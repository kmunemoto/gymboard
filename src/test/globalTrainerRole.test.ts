import { describe, it, expect } from "vitest";
import {
  OWN_ROW,
  TENANT_SCOPED,
  effectivePolicies,
  extractClauses,
  splitTopLevelOr,
  type Policy,
} from "./helpers/rlsPolicies";

// **`has_role(auth.uid(), 'trainer')` だけで書き込めるポリシーを作らせない。**
//
// ── なぜ ──────────────────────────────────────────────────────
// `has_role` が見る `public.user_roles` に `tenant_id` は無い。
// つまり trainer は**テナント横断のグローバル権限**であり、
// `signup-trainer` は自己サービス（誰でも登録できる。これは仕様として維持する）。
//
// したがって
//
//   USING (has_role(auth.uid(), 'trainer'::app_role))
//
// とだけ書かれた書き込みポリシーは、実質「インターネットの誰でも書ける」と同義になる。
// 2026-08-03 時点で、全テナント共通のマスタ（raid_bosses / season_events /
// season_pass_config など8テーブル）がこの状態だった。
//
// ── 判定 ──────────────────────────────────────────────────────
// 書き込み（SELECT 以外）の PERMISSIVE ポリシーが `has_role(...'trainer')` を含むなら、
// **同じ枝に**テナント絞りか本人限定が AND されていなければならない。
// OR で並んでいる場合は「全ての枝」が絞られていること（緩い枝が1つでもあれば通る）。
//
// RESTRICTIVE なテナント絞りが張られているテーブルは対象外（AND で潰れるため）。
// この考え方は tenantIsolation.test.ts と同じで、パーサも共有している
// （src/test/helpers/rlsPolicies.ts）。違いは「対象テーブルを列挙しない」こと。
// **列挙するとテーブルが増えたときに漏れる。** ここは全ポリシーを走査する。

const { policies, loopCovered } = effectivePolicies();

const hasRestrictiveTenantScope = (table: string) =>
  loopCovered.has(table) ||
  policies.some((p) => p.table === table && p.restrictive && TENANT_SCOPED.test(p.body));

const GLOBAL_TRAINER_ROLE = /has_role\s*\(\s*auth\.uid\(\)\s*,\s*'trainer'/;

/** 書き込み（既存行に触れる or 新規作成）で、PERMISSIVE なもの */
const isWritePolicy = (p: Policy) => !p.restrictive && p.cmd !== "SELECT";

/** その枝が「テナント絞り」か「本人限定」で閉じているか */
const branchIsScoped = (branch: string) => TENANT_SCOPED.test(branch) || OWN_ROW.test(branch);

/**
 * `has_role(trainer)` に頼っているのに、どこにも絞りが無いポリシーを洗い出す。
 * USING / WITH CHECK のいずれかに緩い枝があれば違反とする。
 *
 * `storage.objects` は対象外。絞りの書き方が `bucket_id` /
 * `storage.foldername(name)` / `auth.uid()::text` と public スキーマのテーブルと
 * まったく違い、この判定では正しく評価できない（パーサもテーブル名を "storage" と
 * 拾ってしまう）。代わりに下で名指しの断言を1つ置いている。
 */
function offendingPolicies(): Policy[] {
  return policies.filter((p) => {
    if (p.table === "storage") return false;
    if (!isWritePolicy(p)) return false;
    if (!GLOBAL_TRAINER_ROLE.test(p.body)) return false;
    if (hasRestrictiveTenantScope(p.table)) return false;
    const clauses = extractClauses(p.body);
    if (clauses.length === 0) return true;
    return clauses.some((clause) => splitTopLevelOr(clause).some((b) => !branchIsScoped(b)));
  });
}

describe("グローバルな trainer ロールだけで書けるポリシーが無いこと", () => {
  it("解析器がポリシーを拾えている", () => {
    // 0件のまま緑になる（＝何も見ていない）事故を防ぐ
    expect(policies.length).toBeGreaterThan(50);
    expect(policies.some((p) => GLOBAL_TRAINER_ROLE.test(p.body))).toBe(true);
  });

  it("書き込みポリシーは必ずテナント絞りか本人限定と AND されている", () => {
    const offenders = offendingPolicies().map(
      (p) => `${p.table} / ${p.name} (${p.cmd}): ${p.body.slice(0, 110)}`,
    );

    expect(
      offenders,
      offenders.length
        ? "trainer ロールだけで書けるポリシーがあります。\n" +
          "trainer は誰でも取れるグローバル権限なので、これは「誰でも書ける」と同義です:\n" +
          offenders.map((o) => `  - ${o}`).join("\n") +
          "\n\n対処:\n" +
          "  そのテナントのデータ … AND tenant_id = public.get_my_tenant_id() を足す\n" +
          "  本人のデータ         … AND auth.uid() = user_id を足す\n" +
          "  全テナント共通のマスタ … 書き込みポリシーを置かない（service_role 専用にする）"
        : undefined,
    ).toEqual([]);
  });

  it("全テナント共通のマスタに書き込みポリシーが無い", () => {
    // 上のテストは「絞られているか」を見るので、書き込みポリシーを1つも持たない
    // 正しい状態も緑になる。ここでは「本当に0件か」を名指しで確認する。
    const SERVICE_ROLE_ONLY = [
      "raid_bosses",
      "raid_reward_items",
      "season_events",
      "season_event_tasks",
      "season_pass_config",
      "season_pass_levels",
      "avatar_customization_items",
      "gym_settings",
    ];
    for (const table of SERVICE_ROLE_ONLY) {
      const writes = policies.filter((p) => p.table === table && isWritePolicy(p));
      expect(
        writes.map((p) => `${p.name} (${p.cmd})`),
        `${table} は全テナント共通のマスタです。書き込みは service_role のみにしてください`,
      ).toEqual([]);
    }
  });

  it("avatars/tenant-logos/ へのアップロードが自分の user_id 始まりに限られている", () => {
    // `foldername[1] = 'tenant-logos' AND has_role(trainer)` だけだと、
    // trainer になれば任意のファイル名で置ける。実際に書くのは Onboarding の
    // `tenant-logos/{user.id}-{timestamp}.{ext}` 1箇所だけ（Onboarding.tsx:115）。
    // オンボーディング時点ではテナントが未作成なので get_my_tenant_id() は使えない。
    const p = policies.find(
      (x) => x.name === "Authenticated avatar uploads scoped to user folder",
    );
    expect(p, "ポリシーを見つけられていない").toBeTruthy();
    expect(p!.body).toMatch(/name LIKE 'tenant-logos\/' \|\| auth\.uid\(\)::text \|\| '-%'/);
  });
});
