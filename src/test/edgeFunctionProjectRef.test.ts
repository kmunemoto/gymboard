import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
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
    expect(src).toMatch(/process\.env\.SUPABASE_URL/);
    // 導出に失敗しても、特定プロジェクトの ref に落ちるフォールバックを持たせないこと
    expect(src).not.toMatch(new RegExp(`\\?\\?\\s*"${UPSTREAM_PROJECT_REF}"`));

    // ⚠️ 上の2つだけでは足りない（2026-08-04、ストレッチボードで実際に取りこぼした）。
    // ファイルのどこかに process.env.SUPABASE_URL があれば通ってしまうので、
    // **各ツールが使っている分**で条件が満たされ、issuer 用の projectRef が
    //   var projectRef = "<自分の project ref>";
    // と焼き付いたままでも緑になっていた。ref が上流のものではなく
    // 「自分のもの」だったため、上の直書き検査にも引っかからない。
    // フォークの remix 元になると、その ref がそのまま次のアプリへ運ばれる。
    //
    // 見るべきは projectRef の**代入そのもの**。文字列リテラルなら落とす。
    const assign = src.match(/(?:var|const|let)\s+projectRef\s*=\s*([^;]+);/);
    expect(assign, "成果物から projectRef の代入を読み取れませんでした").not.toBeNull();
    expect(
      assign![1],
      `projectRef に project ref が焼き付いています: ${assign?.[1]}\n` +
        "生成元（src/lib/mcp/index.ts）を実行時導出に直してから npm run build し直してください。",
    ).toMatch(/process\.env\.SUPABASE_URL/);
  });

  // ⚠️ ここが本丸。成果物を手で直しても `npm run build` で巻き戻る（実際に踏んだ）。
  // 直すべきは生成元で、Vite が値を埋め込む `import.meta.env.VITE_*` を
  // issuer に使わないこと。各ツールと同じ `process.env` を使えば成果物は汎用のままになる。
  it("生成元が import.meta.env で project ref を埋め込んでいない", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/mcp/index.ts"), "utf8");
    expect(src).not.toMatch(/import\.meta\.env\.VITE_SUPABASE_PROJECT_ID/);
    expect(src).toMatch(/process\.env\.SUPABASE_URL/);
  });
});

// deploy-functions.yml は削除した（2026-08-12）。復活させるなら丸腰で戻さないこと。
//
// ── なぜ消したか ─────────────────────────────────────────────────
//
// **18回の実行すべてで Deploy ステップが skipped、しかも全部 success。**
// 2026-07-01 の初回（#1）からそうで、**一度もデプロイしたことがなかった。**
// `SUPABASE_ACCESS_TOKEN` が無いとき「失敗にせずスキップ」する作りだったため。
//
// そして**このプロジェクトでは、そのトークンを用意する方法が無い**。
// ジムボードの Supabase（rrbfwitprzuevzytykrq）は Lovable Cloud の持ち物で、
// 宗本さんの Supabase アカウントには存在しない。アカウントに紐づくアクセストークンは
// 発行しようがない。**直しようがないワークフローだった。**
//
// 実害も出ている。mem/ops/tenant-boundary.md に
// 「#246 は deploy-functions.yml が自動デプロイした（成功を確認済み）」と
// 書き残されていたが、その実行（#14）も skipped だった。
// **緑を見て「デプロイされた」と記録してしまった。**
//
// 実際のデプロイ経路は Lovable のエージェント（supabase--deploy_edge_functions）。
// 詳細は mem/ops/edge-function-deploy.md。
//
// ── 戻すときの条件 ───────────────────────────────────────────────
//
// PROJECT_REF をワークフローに直書きすると、フォークが直し忘れたときに
// **他人（ジムボード）の本番プロジェクトに上書きデプロイする**。
// .env や config.toml と違って Lovable の remix はここを直してくれない
// （ゴルフボードで実際に残っていた・2026-08-03 報告）。
describe("deploy-functions.yml", () => {
  const PATH = join(process.cwd(), ".github/workflows/deploy-functions.yml");
  const exists = existsSync(PATH);

  it("🔴 消したままか、戻すなら .env と突き合わせるガードが付いている", () => {
    if (!exists) return; // 消えているのが現状の正
    const yml = readFileSync(PATH, "utf8");

    // 戻ってきたなら、デプロイ先ガードは必須。
    expect(yml, "PROJECT_REF を .env と突き合わせていません").toMatch(/VITE_SUPABASE_PROJECT_ID/);
    const iCheck = yml.indexOf("VITE_SUPABASE_PROJECT_ID");
    const iDeploy = yml.indexOf("supabase functions deploy");
    expect(iDeploy, "deploy コマンドがありません").toBeGreaterThan(-1);
    expect(iCheck, "突き合わせがデプロイより後です").toBeLessThan(iDeploy);

    const wf = yml.match(/PROJECT_REF:\s*([a-z0-9]+)/);
    const env = readFileSync(join(process.cwd(), ".env"), "utf8")
      .match(/^VITE_SUPABASE_PROJECT_ID="?([a-z0-9]+)"?/m);
    expect(wf).not.toBeNull();
    expect(env).not.toBeNull();
    expect(wf![1]).toBe(env![1]);

    // 🔴 「トークンが無いのでスキップ、でも緑」に戻さない。18回それで騙された。
    expect(
      /has_token|steps\..*\.outputs\.has/.test(yml),
      "トークンが無いときにスキップして緑で終わる作りに戻っています。18回それで騙されました。",
    ).toBe(false);
  });
});
