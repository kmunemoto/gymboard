import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/check-schema-applied.mjs の回帰テスト。
//
// このスクリプトは「本番DBにマイグレーションが適用されているか」を確認する SQL を
// types.ts から生成する。**この種の欠落は tsc もテストもビルドも全部緑のまま素通りする**
// ため（mem/ops/schema-drift.md）、生成が静かに壊れると、確認したつもりで
// 何も確認できていない状態になる。それが一番まずい壊れ方なので、
// 「パーサが何も拾えていないのに正常終了する」ことが起きないかを重点的に見る。
//
// 生成した SQL 自体は、実際に PostgreSQL 16 を立てて
//   - 欠けているものを検出する（偽陰性が無い）
//   - 存在するものを誤検出しない（偽陽性が無い）
//   - フォーク独自のテーブル/カラム/関数を誤検出しない
//   - 期待とDBが一致すれば0行
// を確認済み（2026-08-02）。ここでは生成側の回帰だけを見る。

const SCRIPT = "scripts/check-schema-applied.mjs";
const dir = mkdtempSync(join(tmpdir(), "schemachk-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

let seq = 0;

/** 任意の types.ts 断片でスクリプトを実行し、生成SQL(stdout)とログ(stderr)を返す */
function run(typesSource: string): { sql: string; log: string } {
  const n = seq++;
  const path = join(dir, `types${n}.ts`);
  writeFileSync(path, typesSource);
  const sql = execFileSync("node", [SCRIPT, path], { encoding: "utf8" });
  const log = execFileSync("bash", ["-c", `node ${SCRIPT} ${path} 2>&1 >/dev/null`], {
    encoding: "utf8",
  });
  return { sql, log };
}

/** 最小限の types.ts。Functions は複数行・単一行の両方の書式を含める */
const MINIMAL = `
export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: {
          booking_capacity: number
          gym_name: string
          id: string
        }
        Insert: { id?: string }
        Update: { id?: string }
      }
      booking_waitlist: {
        Row: {
          id: string
          slot_start: string
        }
        Insert: { id?: string }
        Update: { id?: string }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_tenant_booked_slots: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      check_weight_milestones: { Args: { p_user_id: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
  }
}
`;

describe("スキーマ適用チェックSQLの生成", () => {
  it("テーブル・カラム・関数を types.ts から拾える", () => {
    const { sql, log } = run(MINIMAL);
    expect(log).toContain("2 テーブル");
    expect(log).toContain("5 カラム"); // tenants 3列 + booking_waitlist 2列
    expect(log).toContain("2 関数");
    for (const t of ["tenants", "booking_waitlist"]) {
      expect(sql, `expected_tables に ${t} が無い`).toContain(`('${t}')`);
    }
    expect(sql).toContain("('tenants','booking_capacity')");
    expect(sql).toContain("('booking_waitlist','slot_start')");
  });

  it("Functions の単一行書式も拾う（`$` 固定だと8件取りこぼしていた実バグの回帰）", () => {
    // types.ts は同じ Functions ブロックに複数行と単一行を混在させる。
    // 単一行を落とすと「関数は全部適用済み」という誤った安心が出る。
    const { sql } = run(MINIMAL);
    expect(sql, "複数行書式が拾えていない").toContain("('get_tenant_booked_slots'");
    expect(sql, "単一行書式が拾えていない").toContain("('check_weight_milestones'");
  });

  it("アプリが実際に呼ぶ RPC には印を付け、最優先で並べる", () => {
    // get_tenant_booked_slots は CustomerBooking / TrialBooking が呼ぶ実在のRPC。
    // 欠けると予約画面が壊れるので、他の欠落に埋もれてはいけない。
    const { sql } = run(MINIMAL);
    expect(sql).toContain("('get_tenant_booked_slots',true)");
    expect(sql).toContain("MISSING RPC (CALLED BY APP)");
    // 呼び出しの有無で sort_key を 0 と 3 に分ける
    expect(sql).toMatch(/case when e\.is_called_by_app then 0 else 3 end/);
  });

  it("読み取り専用のSQLしか生成しない（本番DBに対して実行するため）", () => {
    const { sql } = run(MINIMAL);
    // 生成物にDDL/DMLが混じっていないこと。誤って本番を書き換えたら取り返しがつかない。
    for (const forbidden of [
      /\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i,
      /\bDROP\b/i, /\bALTER\b/i, /\bCREATE\s+(TABLE|FUNCTION|INDEX)\b/i, /\bTRUNCATE\b/i,
    ]) {
      expect(sql, `生成SQLに書き込み系が含まれる: ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("テーブルを1つも拾えなければ正常終了しない（黙って「適用漏れ無し」を出さない）", () => {
    // 一番危険な壊れ方は、パーサが何も拾えていないのに0行が返って
    // 「適用漏れ無し」と誤解すること。空の期待値でSQLを出してはいけない。
    const broken = "export type Database = { public: { Tables: {}, Views: {}, Functions: {}, Enums: {} } }";
    expect(() => run(broken)).toThrow();
  });

  it("本物の types.ts を処理でき、既知の重要オブジェクトを含む", () => {
    const sql = execFileSync("node", [SCRIPT], { encoding: "utf8" });
    // 予約画面の中核RPCと、過去に実際に未適用だったもの（mem/ops/schema-drift.md）
    expect(sql).toContain("('get_tenant_booked_slots',true)");
    expect(sql).toContain("('booking_waitlist')");
    expect(sql).toContain("('tenant_muscle_groups')");
    expect(sql).toContain("('tenants','booking_capacity')");
    expect(sql).toContain("('tenant_plans','slot_duration_minutes')");
  });
});
