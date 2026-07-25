import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// マイグレーションが本番DBに「適用されたか分からない」問題を検出するテスト。
//
// 背景:
//   supabase/migrations/*.sql はリポジトリに置いてあるだけで、適用は Lovable / Supabase 側の
//   仕事なので、コミットされている＝適用済み とは限らない。未適用のまま気付かずにいると、
//   クエリが "column does not exist" で落ちたり（→ useTenant の段階フォールバックが増える）、
//   `as any` で型を握り潰した箇所が実行時に静かに失敗したりする。
//
// 検出のしくみ:
//   src/integrations/supabase/types.ts は **本番DBの実スキーマから自動生成** される。
//   つまり「migrations で作ったはずのテーブル/カラムが types.ts に無い」なら、
//   そのマイグレーションはまだ適用されていない（か、生成が止まっている）。
//   このテストはその差分を洗い出し、既知ぶん(KNOWN_DRIFT)以外が出たら落ちる。
//
// 直しかた:
//   1. Supabase SQL Editor で該当マイグレーションを実行する
//   2. types.ts を再生成する（Lovable 側で自動、または supabase gen types）
//   3. KNOWN_DRIFT から該当エントリを消す

const MIGRATIONS_DIR = "supabase/migrations";
const TYPES_PATH = "src/integrations/supabase/types.ts";

/**
 * 未適用と判明している既知の乖離。**新しい乖離を増やさないための番人**であって、
 * ここに足すこと自体が「本番DBに反映されていない」という申し送りになる。
 * 解消したらエントリごと削除する（残したままだと逆に「適用済みなのに未適用扱い」で落ちる）。
 */
const KNOWN_DRIFT: Record<string, string> = {
  "booking_waitlist":
    "キャンセル待ち機能(20260624120000)。types.ts に一度も現れたことがなく、以降のtypes再生成でも出てこないため本番未適用の可能性が高い。src/hooks/useWaitlist.ts は `as any` で参照しているため型エラーにならず気付けなかった。",
  "profiles.milestone_goal":
    "3ヶ月ごとの中目標(20260708150000)。同上。TrainerClientDetail.tsx が `as any` で読み書きしている。",
  "profiles.milestone_goal_set_at":
    "同上（milestone_goal と同じマイグレーション）。",
};

// ---------------------------------------------------------------------------
// types.ts（＝本番DBのスナップショット）を読む
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

describe("スキーマ乖離（migrations と本番DB由来の types.ts の突き合わせ）", () => {
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

  it("migrations で宣言したテーブル/カラムが本番DB(types.ts)にすべて存在する", () => {
    const drift: string[] = [];
    for (const [table, cols] of declared) {
      const actual = generated.get(table);
      if (!actual) {
        drift.push(table);
        continue;
      }
      for (const col of cols) if (!actual.has(col)) drift.push(`${table}.${col}`);
    }

    const unexpected = drift.filter((d) => !(d in KNOWN_DRIFT));
    expect(
      unexpected,
      unexpected.length
        ? `本番DBに未適用の可能性があるマイグレーションがあります:\n` +
          unexpected.map((d) => `  - ${d}`).join("\n") +
          `\n\n対処: Supabase で該当マイグレーションを適用し types.ts を再生成する。` +
          `\n未適用のまま進めるなら KNOWN_DRIFT に理由付きで登録する（src/test/schemaDrift.test.ts）。`
        : undefined,
    ).toEqual([]);
  });

  it("KNOWN_DRIFT に解消済みのエントリが残っていない", () => {
    // 適用されたのに登録が残っていると、次の乖離を「既知」として見逃してしまう
    const resolved = Object.keys(KNOWN_DRIFT).filter((key) => {
      const [table, col] = key.split(".");
      const actual = generated.get(table);
      return col ? actual?.has(col) : Boolean(actual);
    });
    expect(
      resolved,
      resolved.length
        ? `本番DBに存在するのに KNOWN_DRIFT に残っています。エントリを削除してください: ${resolved.join(", ")}`
        : undefined,
    ).toEqual([]);
  });
});
