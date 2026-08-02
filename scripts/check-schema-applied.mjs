#!/usr/bin/env node
/**
 * types.ts（＝コードが期待するスキーマ）から、
 * 「本番DBに適用済みか」を確認するための SQL を1本生成する。
 *
 * なぜ必要か:
 *   `supabase/migrations/*.sql` はリポジトリに置いてあるだけで、適用は Supabase 側の仕事。
 *   コミット済み＝本番DBに反映済み、ではない（mem/ops/schema-drift.md）。
 *   そして**この種の欠落は tsc もテストもビルドも全部緑のまま素通りする**。
 *   実DBを見る以外に確認する方法がない。
 *
 * なぜ「SQLを出力するだけ」なのか:
 *   クラウドセッションからは `*.supabase.co` がネットワークポリシーで遮断されており、
 *   エージェントが直接DBを見に行けない。生成した SQL を人間が Supabase の
 *   SQL Editor に貼れば、**認証情報をエージェントに渡さずに**確認できる。
 *
 * 使い方:
 *   node scripts/check-schema-applied.mjs > /tmp/check.sql
 *   # /tmp/check.sql の中身を Supabase ダッシュボード → SQL Editor に貼って実行
 *   # 0行なら適用漏れ無し。行が返ったらそれが不足しているもの。
 *
 * 兄弟アプリ（業種フォーク）でも同じように使える。フォークは自分の types.ts を
 * 持っているので、このスクリプトをそのまま実行すればよい。
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";

const TYPES_PATH = process.argv[2] ?? "src/integrations/supabase/types.ts";
const SRC_DIRS = ["src", "supabase/functions"];

// ---------------------------------------------------------------------------
// types.ts を読む
// ---------------------------------------------------------------------------

/** `Tables:` 配下の {テーブル名 => Row のカラム集合} */
function readTables(src) {
  const tablesBlock = sliceSection(src, "Tables");
  const tables = new Map();
  const re = /\n {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}\n/g;
  for (let m = re.exec(tablesBlock); m; m = re.exec(tablesBlock)) {
    const cols = new Set();
    const col = /^ {10}(\w+):/gm;
    for (let c = col.exec(m[2]); c; c = col.exec(m[2])) cols.add(c[1]);
    tables.set(m[1], cols);
  }
  return tables;
}

/**
 * `Functions:` 配下の関数名（RPC）。
 * types.ts は同じ Functions ブロックの中に2種類の書式を混在させる:
 *   複数行:  `      get_tenant_public: {\n        Args: ...`
 *   単一行:  `      check_weight_milestones: { Args: { p_user_id: string }; Returns: Json }`
 * 行末の `$` を要求すると単一行を丸ごと取りこぼす（実際に8件落ちていた）。
 * 関数名はインデント6、中身は8以上なので、`$` 無しでも過剰マッチしない。
 */
function readFunctions(src) {
  const block = sliceSection(src, "Functions");
  const names = new Set();
  const re = /^ {6}(\w+): \{/gm;
  for (let m = re.exec(block); m; m = re.exec(block)) names.add(m[1]);
  return names;
}

/**
 * `public:` 配下の指定セクションだけを切り出す。
 * Tables / Views / Functions / Enums / CompositeTypes は同じインデント(4)で並ぶので、
 * 次の同インデントのキーまでを取る。
 */
function sliceSection(src, name) {
  const start = src.indexOf(`\n    ${name}: {\n`);
  if (start === -1) throw new Error(`types.ts に ${name}: セクションが見つかりません`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n {4}(?:Tables|Views|Functions|Enums|CompositeTypes): \{\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

// ---------------------------------------------------------------------------
// 実際に呼ばれている RPC を拾う（欠けたときの影響が大きい順に並べるため）
// ---------------------------------------------------------------------------

function readCalledRpcs() {
  const called = new Set();
  for (const dir of SRC_DIRS) {
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      const re = /\.rpc\(\s*["'`](\w+)["'`]/g;
      for (let m = re.exec(text); m; m = re.exec(text)) called.add(m[1]);
    }
  }
  return called;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

// ---------------------------------------------------------------------------

const src = readFileSync(TYPES_PATH, "utf8");
const tables = readTables(src);
const functions = readFunctions(src);
const calledRpcs = readCalledRpcs();

if (tables.size === 0) {
  console.error(`${TYPES_PATH} からテーブルを1つも読めませんでした。パーサを確認してください。`);
  process.exit(1);
}

/** SQL のリテラルとして安全な形に（識別子しか来ないが念のため） */
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const tableRows = [...tables.keys()].sort().map((t) => `(${lit(t)})`);
const columnRows = [...tables.entries()]
  .flatMap(([t, cols]) => [...cols].sort().map((c) => `(${lit(t)},${lit(c)})`))
  .sort();
// 実際に呼ばれている RPC を先に出す（欠けたときに画面が壊れるのはこちら）
const functionRows = [...functions]
  .sort()
  .map((f) => `(${lit(f)},${calledRpcs.has(f) ? "true" : "false"})`);

const totalCols = columnRows.length;

process.stdout.write(`-- ============================================================
-- スキーマ適用チェック（自動生成 / scripts/check-schema-applied.mjs）
--   元: ${TYPES_PATH}
--   期待: ${tables.size} テーブル / ${totalCols} カラム / ${functions.size} 関数
--
-- 使い方: この SQL 全体を Supabase ダッシュボード → SQL Editor に貼って実行。
--   **結果が0行なら適用漏れ無し。** 行が返ったら、それが本番DBに足りないもの。
--   読み取り専用（information_schema / pg_proc を見るだけ）でDBは一切変更しない。
--
-- ⚠️ 実行前に、接続先が意図したプロジェクトか必ず確認すること:
--     select current_database(), current_setting('request.jwt.claim.iss', true);
--   似た名前のプロジェクトが複数ある（mem/ops/schema-drift.md）。
-- ============================================================

with expected_tables(table_name) as (values
  ${tableRows.join(",\n  ")}
),
expected_columns(table_name, column_name) as (values
  ${columnRows.join(",\n  ")}
),
expected_functions(routine_name, is_called_by_app) as (values
  ${functionRows.join(",\n  ")}
),
live_tables as (
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
),
live_columns as (
  select table_name, column_name from information_schema.columns
  where table_schema = 'public'
),
live_functions as (
  select p.proname as routine_name
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
-- 1) 丸ごと存在しないテーブル
select
  1 as sort_key,
  'MISSING TABLE' as kind,
  e.table_name as name,
  '' as detail,
  'テーブルごと未適用。関連機能は全滅します。' as impact
from expected_tables e
left join live_tables l using (table_name)
where l.table_name is null

union all

-- 2) テーブルはあるがカラムが無い（既存テーブルへの ADD COLUMN が未適用）
select
  2,
  'MISSING COLUMN',
  e.table_name,
  e.column_name,
  '読み書きが実行時に失敗します。tsc・テストは緑のまま素通りします。'
from expected_columns e
join live_tables lt on lt.table_name = e.table_name   -- テーブルごと無い場合は 1) で出るので除く
left join live_columns lc on lc.table_name = e.table_name and lc.column_name = e.column_name
where lc.column_name is null

union all

-- 3) 関数/RPC が無い（アプリが実際に呼んでいるものは最優先）
select
  case when e.is_called_by_app then 0 else 3 end,
  case when e.is_called_by_app then 'MISSING RPC (CALLED BY APP)' else 'MISSING FUNCTION' end,
  e.routine_name,
  '',
  case when e.is_called_by_app
       then '★ アプリが実際に呼び出しています。該当画面が確実に壊れます。'
       else '現状アプリからの呼び出しは見つかりませんでした（トリガー等から使われている可能性あり）。'
  end
from expected_functions e
left join live_functions l using (routine_name)
where l.routine_name is null

order by sort_key, name, detail;
`);

console.error(
  `生成しました: ${tables.size} テーブル / ${totalCols} カラム / ${functions.size} 関数` +
    `（うちアプリが実際に呼ぶ RPC: ${[...functions].filter((f) => calledRpcs.has(f)).length}件）`,
);
