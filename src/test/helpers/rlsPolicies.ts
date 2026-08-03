import { readFileSync, readdirSync } from "node:fs";

// マイグレーションSQLを畳み込んで「最終的に有効なRLSポリシー」を求めるパーサ。
//
// tenantIsolation.test.ts のために書いたものを、tenantMembershipWrites.test.ts と
// 共有するためにここへ出した。**重複させないこと。**
// 畳み込み（CREATE で登録 / DROP で削除 / 同名 CREATE で置換）を間違えると、
// テストは「緑のまま何も見ていない」状態になり、それに気づく手段が無い。

export const MIGRATIONS_DIR = "supabase/migrations";

/** テナントで絞っていると認めるヘルパー（いずれも呼び出し元のテナントを見る） */
export const TENANT_SCOPED = /get_my_tenant_id|is_tenant_member|has_tenant_role|shares_tenant_with_me/;

/** 「自分の行だけ」と認める形。ここに無い書き方をしたら、それは横断アクセスとして扱う */
export const OWN_ROW = /auth\.uid\(\)\s*=\s*\w*_?(?:user_)?id\b|\b\w*_?(?:user_)?id\s*=\s*auth\.uid\(\)/;

export const stripSqlComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

export interface Policy {
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
 * 保護されているテーブルを「無防備」と誤判定する（tenantIsolation.test.ts 冒頭の経緯）。
 */
export function effectivePolicies(): { policies: Policy[]; loopCovered: Set<string> } {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const map = new Map<string, Policy>();
  const loopCovered = new Set<string>();

  for (const file of files) {
    const sql = stripSqlComments(readFileSync(`${MIGRATIONS_DIR}/${file}`, "utf8"));

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

/**
 * `USING (...)` / `WITH CHECK (...)` の中身を、括弧の対応を見ながら取り出す。
 */
export function extractClauses(body: string): string[] {
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
export function splitTopLevelOr(expr: string): string[] {
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
