import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Edge Function の npm import がバージョン固定されていることを見張る。
//
// ── なぜ要るか（2026-08-13）─────────────────────────────────────────
//
// `npm:@lovable.dev/email-js`（バージョン指定なし）が2ファイルにあった。
// 同じファイルの他の import は全部固定されている（react@18.3.1 等）ので、
// **ここだけ latest 解決**になっていた。
//
// Deno はデプロイ時に解決するので:
//
//   ・上流が壊れた版を出した日に**再デプロイしたら**メールが止まる
//   ・コードは1文字も変えていないのに壊れる（差分を見ても原因が分からない）
//   ・エラーはデプロイ時ではなく**送信時**に出る
//
// しかもメールは「送れなかったこと」に気づきにくい。0.x のパッケージは
// マイナー更新で破壊的変更が入りうるので、なおさら固定する。
//
// ストレッチボードの調査で指摘され、上流（ジムボード）にも同じ問題があった。
// 調べたら `@lovable.dev/webhooks-js` も未固定で、**そちらは指摘に入っていなかった**。

const FUNCTIONS_DIR = "supabase/functions";

/** `npm:<name>[@<version>][/<path>]` を name と version に割る。 */
function parseNpmSpecifier(spec: string): { name: string; version: string | null } {
  const body = spec.slice("npm:".length);
  // スコープ付き（@scope/name）は先頭の @ を名前の一部として扱う
  const at = body.indexOf("@", body.startsWith("@") ? 1 : 0);
  if (at === -1) return { name: body.split("/")[0], version: null };
  const name = body.slice(0, at);
  const rest = body.slice(at + 1);
  return { name, version: rest.split("/")[0] || null };
}

/** functions 配下の .ts を全部集める */
function allFunctionSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".ts")) out.push(p);
    }
  };
  if (existsSync(FUNCTIONS_DIR)) walk(FUNCTIONS_DIR);
  return out;
}

describe("Edge Function の npm import", () => {
  const files = allFunctionSources();

  it("走査が空振りしていない", () => {
    expect(files.length, "Edge Function のソースが見つかりません").toBeGreaterThan(10);
  });

  it("🔴 バージョンを固定している（latest 解決にしない）", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/["'](npm:[^"']+)["']/g)) {
        const { name, version } = parseNpmSpecifier(m[1]);
        if (!version) offenders.push(`  ${f}\n      ${m[1]}  ← ${name} の版が無い`);
      }
    }
    expect(
      offenders,
      "npm import にバージョンがありません。デプロイ時に latest へ解決されるので、" +
        "上流が壊れた日にコードを変えていなくても本番が止まります:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("🔴 Lovable のライブラリは 0.x なので完全固定（^ や ~ を付けない）", () => {
    // 0.x はマイナー更新で破壊的変更が入りうる。範囲指定だと固定した意味が薄れる。
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/["'](npm:@lovable\.dev\/[^"']+)["']/g)) {
        const { name, version } = parseNpmSpecifier(m[1]);
        if (version && /[\^~><*]/.test(version)) {
          offenders.push(`  ${f}: ${name}@${version}`);
        }
      }
    }
    expect(offenders, `Lovable のライブラリに範囲指定があります:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });
});

describe("LOVABLE_SEND_URL は完全なURL", () => {
  const SRC = readFileSync(`${FUNCTIONS_DIR}/process-email-queue/index.ts`, "utf8");

  it("🔴 「ベースURL」と誤解させるコメントに戻さない", () => {
    // ライブラリの実装（0.1.2 で確認）:
    //   const url = options.sendUrl || `${resolveApiBaseUrl(options.apiBaseUrl)}${DEFAULT_SEND_PATH}`;
    // sendUrl は**そのまま叩かれ、パスは足されない**。
    // https://api.lovable.dev だけ入れるとパス無しで POST して失敗する。
    expect(SRC, "sendUrl が完全なURLであることが書かれていません").toMatch(
      /LOVABLE_SEND_URL[\s\S]{0,200}完全なURL/,
    );
    expect(SRC, "正しい完全なURLの例がありません").toContain("/v1/messaging/email/send");
  });
});
