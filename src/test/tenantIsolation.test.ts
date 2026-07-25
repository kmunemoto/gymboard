import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

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

const MIGRATIONS_DIR = "supabase/migrations";

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

/** テナントで絞っていると認めるヘルパー（いずれも呼び出し元のテナントを見る） */
const TENANT_SCOPED = /get_my_tenant_id|is_tenant_member|has_tenant_role|shares_tenant_with_me/;

/** 「自分の行だけ」と認める形。ここに無い書き方をしたら、それは横断アクセスとして扱う */
const OWN_ROW = /auth\.uid\(\)\s*=\s*\w*_?(?:user_)?id\b|\b\w*_?(?:user_)?id\s*=\s*auth\.uid\(\)/;

const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

interface Policy {
  table: string;
  name: string;
  restrictive: boolean;
  cmd: string;
  body: string;
}

/**
 * マイグレーションをファイル名順に畳み込んで、最終的に有効なポリシーの一覧を作る。
 * CREATE で登録、DROP で削除、同名 CREATE で置き換え。
 *
 * DOループ内の動的生成（EXECUTE format(...)）も展開する。ここを飛ばすと
 * 保護されているテーブルを「無防備」と誤判定する（冒頭の経緯を参照）。
 */
function effectivePolicies(): { policies: Policy[]; loopCovered: Set<string> } {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const map = new Map<string, Policy>();
  const loopCovered = new Set<string>();

  for (const file of files) {
    const sql = stripComments(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));

    // DOループによる RESTRICTIVE 一括適用
    for (const block of sql.matchAll(/DO\s+\$\$([\s\S]*?)\$\$/g)) {
      const body = block[1];
      if (!/AS RESTRICTIVE/i.test(body) || !TENANT_SCOPED.test(body)) continue;
      for (const arr of body.matchAll(/ARRAY\s*\[([^\]]+)\]/g)) {
        for (const t of arr[1].matchAll(/'(\w+)'/g)) loopCovered.add(t[1]);
      }
    }

    for (const m of sql.matchAll(
      /DROP POLICY\s+(?:IF EXISTS\s+)?("[^"]+"|\w+)\s+ON\s+(?:public\.)?"?(\w+)"?/gi,
    )) {
      map.delete(`${m[2]}::${m[1].replace(/"/g, "")}`);
    }

    for (const m of sql.matchAll(
      /CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+(?:public\.)?"?(\w+)"?([\s\S]*?);/gi,
    )) {
      const name = m[1].replace(/"/g, "");
      const rest = m[3];
      const cmd = /FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)/i.exec(rest)?.[1]?.toUpperCase() ?? "ALL";
      map.set(`${m[2]}::${name}`, {
        table: m[2],
        name,
        restrictive: /AS\s+RESTRICTIVE/i.test(rest),
        cmd,
        body: rest.replace(/\s+/g, " ").trim(),
      });
    }
  }
  return { policies: [...map.values()], loopCovered };
}

const { policies, loopCovered } = effectivePolicies();

/** そのテーブルに RESTRICTIVE なテナント絞りがあるか */
const hasRestrictiveTenantScope = (table: string) =>
  loopCovered.has(table) ||
  policies.some((p) => p.table === table && p.restrictive && TENANT_SCOPED.test(p.body));

/** 既存行に触れる（＝漏洩しうる）ポリシーか。INSERT は新規作成なので対象外 */
const touchesExistingRows = (p: Policy) => p.cmd !== "INSERT" && !p.restrictive;

/**
 * `USING (...)` / `WITH CHECK (...)` の中身を、括弧の対応を見ながら取り出す。
 */
function extractClauses(body: string): string[] {
  const out: string[] = [];
  const re = /\b(?:USING|WITH\s+CHECK)\s*\(/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < body.length && depth > 0) {
      if (body[i] === "(") depth++;
      else if (body[i] === ")") depth--;
      i++;
    }
    out.push(body.slice(start, i - 1));
  }
  return out;
}

/**
 * 最上位の OR で分割する（括弧の内側の OR は分割しない）。
 *
 * ここが肝。`auth.uid() = user_id OR has_role(...)` を「本人限定の記述がある」と
 * ひとまとめに見てしまうと、**OR の相手側が全ジム横断でも安全と誤判定する**。
 * 実際、最初に書いたテストはこの誤りで、修正を外しても緑のままだった。
 * OR は「どちらかを満たせば通る」なので、**全ての枝**が絞られていなければ意味がない。
 */
function splitTopLevelOr(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    cur += ch;
    if (depth === 0 && /\sOR\s$/i.test(cur)) {
      parts.push(cur.slice(0, -4));
      cur = "";
    }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

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
