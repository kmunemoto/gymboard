import { describe, it, expect } from "vitest";
import {
  OWN_ROW,
  TENANT_SCOPED,
  effectivePolicies,
  extractClauses,
  splitTopLevelOr,
  type Policy,
} from "./helpers/rlsPolicies";

// マルチテナントSaaSとして最も重要な不変条件:
//   **あるジムのトレーナーが、別のジムの顧客データに触れられてはいけない。**
//
// ── なぜこのテストが要るか ──────────────────────────────────────
// テナント分離のポリシーは3つの `DO $$ ... FOREACH ... EXECUTE format(...)` ループで
// **動的生成**されている（20260517100152 / 20260529082706 / 20260530080359）。
// そのため `CREATE POLICY ... ON <テーブル名>` をそのまま検索しても**1件も出てこない**。
//
// 2026-07-25、この点を2度読み違えた:
//   1回目: 「tenant_isolation が付いているのは1テーブルだけ」と誤読
//   2回目: weight_journey / user_avatars / weight_journey_milestones の3つが
//          無防備だと結論し、修正マイグレーションまで書いた。実際には
//          20260529082706 / 20260530080359 で既に tenant_user_isolation
//          （auth.uid() = user_id OR shares_tenant_with_me(user_id)）が
//          RESTRICTIVE で張られており、**まったくの誤検知だった**。
//
// 目視で追うと必ず間違えるので、ループ展開まで含めて機械的に検証する。
//
// ── 判定の考え方 ────────────────────────────────────────────────
// PostgreSQL のRLSは PERMISSIVE 同士が OR、RESTRICTIVE が AND で結合される。
// つまり「緩い PERMISSIVE が1つでもあれば漏れる」。安全と言えるのは:
//
//   (A) RESTRICTIVE なテナント絞りがある
//       → PERMISSIVE がいくら緩くても AND で潰れる。
//         bookings の "USING (true)"（空き枠照会用）や weight_journey の
//         "OR has_role(...)" が許されるのはこのため
//   (B) RESTRICTIVE が無いなら、既存行に触れる PERMISSIVE が
//       **すべて** テナント絞りか本人限定であること
//
// どちらでもないテーブルが出たらこのテストが落ちる。

/** 顧客の個人データを持ち、テナント越境を塞ぐ必要があるテーブル */
const CUSTOMER_DATA_TABLES = [
  "announcements",
  "blocked_slots",
  "booking_waitlist",
  "bookings",
  "counseling_responses",
  "exercises",
  "meals",
  "messages",
  "monthly_reports",
  "notification_settings",
  "profiles",
  "progress_photos",
  "skeletal_diagnoses",
  "tenant_members",
  "tenant_muscle_groups",
  "tenant_plans",
  "trial_bookings",
  "user_avatars",
  "user_measurements",
  "weight_journey",
  "weight_journey_milestones",
  "workouts",
];

const { policies, loopCovered } = effectivePolicies();

/** そのテーブルに RESTRICTIVE なテナント絞りがあるか */
const hasRestrictiveTenantScope = (table: string) =>
  loopCovered.has(table) ||
  policies.some((p) => p.table === table && p.restrictive && TENANT_SCOPED.test(p.body));

/** 既存行に触れる（＝漏洩しうる）ポリシーか。INSERT は新規作成なので対象外 */
const touchesExistingRows = (p: Policy) => p.cmd !== "INSERT" && !p.restrictive;

/** そのポリシーがテナント絞りか本人限定になっているか（OR の全枝が絞られていること） */
const isScoped = (p: Policy) => {
  const clauses = extractClauses(p.body);
  if (clauses.length === 0) return false;
  return clauses.every((clause) =>
    splitTopLevelOr(clause).every((branch) => TENANT_SCOPED.test(branch) || OWN_ROW.test(branch)),
  );
};

describe("テナント分離（他ジムの顧客データに触れられないこと）", () => {
  it("解析器が DO ループ内の一括適用を展開できている", () => {
    // ここが壊れると「全テーブル未保護」と誤判定し、本当の漏れが埋もれる
    for (const t of ["bookings", "workouts", "meals", "messages"]) {
      expect(loopCovered, `${t} の一括適用を拾えていない`).toContain(t);
    }
  });

  it("解析器がポリシーのCREATE/DROPを畳み込めている", () => {
    expect(policies.length).toBeGreaterThan(50);
    expect(policies.some((p) => p.table === "counseling_responses")).toBe(true);
    expect(policies.some((p) => p.table === "profiles" && p.restrictive)).toBe(true);
  });

  it("顧客データを持つ全テーブルで、テナント越境が塞がれている", () => {
    const offenders: string[] = [];

    for (const table of CUSTOMER_DATA_TABLES) {
      // (A) RESTRICTIVE のテナント絞りがあれば、PERMISSIVE がどれだけ緩くても AND で潰れる
      if (hasRestrictiveTenantScope(table)) continue;

      // (B) 無いなら、既存行に触れる PERMISSIVE がすべて絞られていること
      const leaky = policies.filter(
        (p) => p.table === table && touchesExistingRows(p) && !isScoped(p),
      );
      for (const p of leaky) {
        offenders.push(`${table} / ${p.name} (${p.cmd}): ${p.body.slice(0, 90)}`);
      }
    }

    expect(
      offenders,
      offenders.length
        ? `別のジムのトレーナーから読み書きできるポリシーがあります:\n` +
          offenders.map((o) => `  - ${o}`).join("\n") +
          `\n\n対処: RESTRICTIVE なテナント絞りを足すか、ポリシー自体を絞る。` +
          `\n  tenant_id がある  → USING (tenant_id = public.get_my_tenant_id())` +
          `\n  tenant_id が無い  → USING (auth.uid() = user_id OR public.shares_tenant_with_me(user_id))`
        : undefined,
    ).toEqual([]);
  });

  it("PERMISSIVE が緩いテーブルは、必ず RESTRICTIVE で守られている", () => {
    // これらは "OR has_role(...)"（ジムを問わないトレーナー権限）や "USING (true)" を
    // 持つが、RESTRICTIVE のテナント絞りが AND されるため安全。
    // ループの配列から1つ抜けただけで無防備になるので、名指しで確認する。
    for (const t of ["weight_journey", "weight_journey_milestones", "user_avatars", "bookings", "workouts"]) {
      expect(hasRestrictiveTenantScope(t), `${t} のテナント絞りが消えている`).toBe(true);
    }
  });
});
