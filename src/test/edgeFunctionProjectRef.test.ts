import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Edge Function に Supabase の project ref が焼き込まれていないことを見張る。
//
// ゴルフボードの棚卸しで判明した上流の穴（2026-08-03 報告）。
// `src/lib/mcp/index.ts` は `import.meta.env.VITE_SUPABASE_PROJECT_ID` から読むが、
// **ビルド成果物の `supabase/functions/mcp/index.ts` には Vite がビルド時に
// ジムボードの ref を焼き込む**。成果物はリポジトリにコミットされているので、
// フォークが `.env` を直しても**この1ファイルだけが上流のプロジェクトを向く**。
//
// 症状: 別プロジェクトの issuer で OAuth 認証を要求する。
// **型もテストもビルドも全部通るので、実際に MCP を使うまで気づけない。**
//
// 同じ理由で `.github/workflows/deploy-functions.yml` の PROJECT_REF も危険
// （そちらはワークフロー側でプリフライトを入れてある）。

const FUNCTIONS_DIR = join(process.cwd(), "supabase/functions");

/** ジムボードの Supabase project ref。フォークにこれが残っていたら事故。 */
const UPSTREAM_PROJECT_REF = "rrbfwitprzuevzytykrq";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe("Edge Function に project ref が焼き込まれていない", () => {
  const files = walk(FUNCTIONS_DIR);

  it("走査対象の Edge Function がある（テストが空振りしていない）", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("どのファイルにも project ref の直書きが無い", () => {
    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes(UPSTREAM_PROJECT_REF))
      .map((f) => f.replace(process.cwd() + "/", ""));

    // ここが落ちたら:
    //   1. MCP の成果物を再生成した → projectRef の行を実行時導出に戻す
    //   2. 新しい Edge Function に ref を直書きした → SUPABASE_URL から導出する
    // フォーク（兄弟アプリ）でこれが落ちたら、それは上流から流入した値なので必ず直すこと。
    expect(offenders).toEqual([]);
  });

  it("mcp の issuer は実行時に SUPABASE_URL から導出している", () => {
    const src = readFileSync(join(FUNCTIONS_DIR, "mcp/index.ts"), "utf8");
    expect(src).toMatch(/Deno\.env\.get\("SUPABASE_URL"\)/);
    // 導出に失敗しても、上流の ref に落ちるフォールバックを持たせないこと
    expect(src).not.toMatch(new RegExp(`\\?\\?\\s*"${UPSTREAM_PROJECT_REF}"`));
  });
});

// deploy-functions.yml が「別プロジェクトへのデプロイ」を止めること。
//
// PROJECT_REF はワークフローに直書きなので、フォークが直し忘れると
// 他人（ジムボード）の本番プロジェクトに Edge Function を上書きデプロイする。
// .env や config.toml と違って Lovable の remix はここを直してくれない
// （ゴルフボードで実際に残っていた・2026-08-03 報告）。
describe("deploy-functions.yml のデプロイ先ガード", () => {
  const yml = readFileSync(join(process.cwd(), ".github/workflows/deploy-functions.yml"), "utf8");

  it("デプロイ前に .env の VITE_SUPABASE_PROJECT_ID と突き合わせている", () => {
    expect(yml).toMatch(/VITE_SUPABASE_PROJECT_ID/);
    expect(yml).toMatch(/ENV_REF.*!=.*PROJECT_REF|"\$ENV_REF" != "\$PROJECT_REF"/);
  });

  it("突き合わせは実際のデプロイ手前で行われる", () => {
    const iCheck = yml.indexOf("VITE_SUPABASE_PROJECT_ID");
    const iDeploy = yml.indexOf("supabase functions deploy");
    expect(iCheck).toBeGreaterThan(-1);
    expect(iDeploy).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iDeploy);
  });

  it("このリポジトリでは PROJECT_REF と .env が一致している", () => {
    const wf = yml.match(/PROJECT_REF:\s*([a-z0-9]+)/);
    const env = readFileSync(join(process.cwd(), ".env"), "utf8")
      .match(/^VITE_SUPABASE_PROJECT_ID="?([a-z0-9]+)"?/m);
    expect(wf).not.toBeNull();
    expect(env).not.toBeNull();
    expect(wf![1]).toBe(env![1]);
  });
});
