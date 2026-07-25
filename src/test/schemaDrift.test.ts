import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// migrations と types.ts のズレを検出するテスト。
//
// **このテストは「本番DBに適用されたか」を判定するものではない。**
//   当初は「types.ts は本番DBから自動生成されるので、そこに無ければ未適用」という前提で
//   書いていたが、2026-07-25 に Lovable MCP 経由で本番DBを直接照会したところ、
//   **types.ts は本番DBより先行しうる**ことが分かった（PRの中で types.ts だけが更新され、
//   マイグレーションは適用されないまま進んでいた）。
//   実際、未適用は6件あったのに、この方式では2件しか検出できていなかった。
//   適用状況の確認手順は mem/ops/schema-drift.md を参照。
//
// このテストが今も守っているもの:
//   migrations で作ったテーブル/カラムが types.ts に載っているか。
//   載っていないと補完も型検査も効かず、`as any` で握り潰す実装になり、
//   タイプミスや列名変更が実行時まで表面化しない。
//
// 直しかた:
//   1. 本番DBに適用済みであることを先に確認する（mem/ops/schema-drift.md の手順）
//   2. types.ts を再生成する（Lovable 側で自動、または supabase gen types）
//   3. KNOWN_STALE から該当エントリを消し、対応する `as any` を外す

const MIGRATIONS_DIR = "supabase/migrations";
const TYPES_PATH = "src/integrations/supabase/types.ts";

/**
 * types.ts に載っていないと分かっている既知のズレ。**新しいズレを増やさないための番人**。
 * 解消したらエントリごと削除する（残したままだと逆に「載っているのに未掲載扱い」で落ちる）。
 *
 * 2026-07-25 現在は空。未適用だった6件を本番DBに適用し、types.ts も実スキーマに
 * 合わせて更新したため、migrations と types.ts は一致している。
 */
const KNOWN_STALE: Record<string, string> = {};

// ---------------------------------------------------------------------------
// types.ts（＝クライアント側が知っているスキーマ）を読む
// ---------------------------------------------------------------------------

/** types.ts の `Tables` から {テーブル名: Rowのカラム集合} を作る */
function readGeneratedSchema(): Map<string, Set<string>> {
  const src = readFileSync(TYPES_PATH, "utf8");
  const schema = new Map<string, Set<string>>();
  // "      tablename: {\n        Row: {\n ...カラム... \n        }\n"
  const table = /\n {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}\n/g;
  for (let m = table.exec(src); m; m = table.exec(src)) {
    const cols = new Set<string>();
    const col = /^ {10}(\w+):/gm;
    for (let c = col.exec(m[2]); c; c = col.exec(m[2])) cols.add(c[1]);
    schema.set(m[1], cols);
  }
  return schema;
}

// ---------------------------------------------------------------------------
// migrations（＝あるべき姿）を読む
// ---------------------------------------------------------------------------

/**
 * マイグレーションをファイル名順に畳み込んで「あるべきスキーマ」を作る。
 * 保守的なパーサで、扱うのは CREATE TABLE / ALTER TABLE ADD COLUMN / DROP TABLE のみ。
 * （2026-07 時点で migrations に現れる DDL はこの3種類だけ。DROP COLUMN / RENAME が
 *  出てきたらここに足す。足し忘れても「あるはずの列が無い」側に倒れるだけで、
 *  乖離を見逃す方向には倒れない）
 */
function readDeclaredSchema(): Map<string, Set<string>> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const schema = new Map<string, Set<string>>();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));

    const dropped = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi;
    for (let m = dropped.exec(sql); m; m = dropped.exec(sql)) schema.delete(m[1]);

    const created = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\);/gi;
    for (let m = created.exec(sql); m; m = created.exec(sql)) {
      const cols = schema.get(m[1]) ?? new Set<string>();
      for (const name of parseCreateTableColumns(m[2])) cols.add(name);
      schema.set(m[1], cols);
    }

    const altered = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?\s+([\s\S]*?);/gi;
    for (let m = altered.exec(sql); m; m = altered.exec(sql)) {
      const add = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;
      for (let c = add.exec(m[2]); c; c = add.exec(m[2])) {
        const cols = schema.get(m[1]);
        // 未知テーブルへの ALTER は、migrations 以前から存在するテーブル
        // （Lovable の UI で直接作られたもの等）。types.ts 側で存在確認する。
        if (cols) cols.add(c[1]);
        else schema.set(m[1], new Set([c[1]]));
      }
    }
  }
  return schema;
}

/** SQLの行コメントとブロックコメントを除去（コメント内に書かれた DDL を拾わないため） */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** CREATE TABLE の括弧内から、列定義の先頭識別子だけを取り出す */
function parseCreateTableColumns(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let current = "";
  const flush = () => {
    const head = current.trim().split(/\s+/)[0]?.replace(/"/g, "");
    // PRIMARY KEY(...) / UNIQUE(...) / CONSTRAINT ... などのテーブル制約は列ではない
    if (head && /^\w+$/.test(head) && !TABLE_CONSTRAINT_KEYWORDS.has(head.toUpperCase())) {
      names.push(head);
    }
    current = "";
  };
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) flush();
    else current += ch;
  }
  flush();
  return names;
}

const TABLE_CONSTRAINT_KEYWORDS = new Set([
  "PRIMARY", "UNIQUE", "CONSTRAINT", "FOREIGN", "CHECK", "EXCLUDE", "LIKE",
]);

// ---------------------------------------------------------------------------

describe("スキーマのズレ（migrations と types.ts の突き合わせ）", () => {
  const generated = readGeneratedSchema();
  const declared = readDeclaredSchema();

  it("types.ts をテーブル定義として読めている", () => {
    // パーサが壊れたときに「乖離ゼロ」と誤判定しないための土台の確認
    expect(generated.size).toBeGreaterThan(50);
    expect(generated.get("tenants")?.has("gym_name")).toBe(true);
    expect(generated.get("bookings")?.has("status")).toBe(true);
  });

  it("migrations をテーブル定義として読めている", () => {
    expect(declared.size).toBeGreaterThan(30);
    // 直近に足したものが declared 側に出ていること（パーサの生存確認）
    expect(declared.get("tenant_muscle_groups")?.has("sort_order")).toBe(true);
    expect(declared.get("tenants")?.has("show_nav_messages")).toBe(true);
  });

  it("migrations で宣言したテーブル/カラムが types.ts に載っている", () => {
    const drift: string[] = [];
    for (const [table, cols] of declared) {
      const actual = generated.get(table);
      if (!actual) {
        drift.push(table);
        continue;
      }
      for (const col of cols) if (!actual.has(col)) drift.push(`${table}.${col}`);
    }

    const unexpected = drift.filter((d) => !(d in KNOWN_STALE));
    expect(
      unexpected,
      unexpected.length
        ? `types.ts に載っていないテーブル/カラムがあります（型が効かず as any になります）:\n` +
          unexpected.map((d) => `  - ${d}`).join("\n") +
          `\n\n対処: 本番DBへの適用を確認したうえで types.ts を再生成する（mem/ops/schema-drift.md）。` +
          `\nすぐ直せないなら KNOWN_STALE に理由付きで登録する（src/test/schemaDrift.test.ts）。`
        : undefined,
    ).toEqual([]);
  });

  it("KNOWN_STALE に解消済みのエントリが残っていない", () => {
    // types.ts に載ったのに登録が残っていると、次のズレを「既知」として見逃してしまう
    const resolved = Object.keys(KNOWN_STALE).filter((key) => {
      const [table, col] = key.split(".");
      const actual = generated.get(table);
      return col ? actual?.has(col) : Boolean(actual);
    });
    expect(
      resolved,
      resolved.length
        ? `types.ts に載っているのに KNOWN_STALE に残っています。エントリを削除してください: ${resolved.join(", ")}`
        : undefined,
    ).toEqual([]);
  });
});
