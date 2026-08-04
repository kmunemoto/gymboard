import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// scripts/build-android.bat の回帰テスト。
//
// ── 何が起きていたか（2026-08-04 に発覚） ──────────────────────────
// 2回目以降のビルドが、必ず最初の `git pull` で止まっていた:
//
//   error: Your local changes to the following files would be overwritten by merge:
//           supabase/functions/mcp/index.ts
//   Please commit your changes or stash them before you merge.
//
// このファイルは `npm run build`（vite.config.ts の mcpPlugin()）が**毎回生成し直す**
// 成果物で、git 追跡下にある。つまり
//
//   1回目: [3/5] npm run build が mcp/index.ts を書き換える → 作業ツリーが汚れる
//   2回目: [1/5] git pull が「上書きしていいか分からない」で中断
//
// という形で**必ず**詰まる。`package-lock.json` は同じ理由で
// 最初から `git checkout --` してあったのに、こちらが漏れていた。
//
// ── なぜテストにするか ────────────────────────────────────────
// .bat は CI でも vitest でも実行されない。**Windows で人が叩くまで誰も気づけない。**
// 「ビルドが作り直す成果物は、pull の前に捨てる」という不変条件を、形で見張る。

const BAT = "scripts/build-android.bat";
const script = readFileSync(BAT, "utf8");

/** ビルド手順が作り直す＝pull 前に捨ててよい（捨てるべき）成果物 */
const GENERATED_ARTIFACTS = [
  // [2/5] npm install が書き換える
  "package-lock.json",
  // [3/5] npm run build が書き換える（vite.config.ts の mcpPlugin()）
  "supabase/functions/mcp/index.ts",
];

describe("build-android.bat: pull を止める生成物を先に捨てる", () => {
  for (const path of GENERATED_ARTIFACTS) {
    it(`${path} を git pull より前に捨てている`, () => {
      const discard = script.indexOf(`git checkout -- ${path}`);
      expect(
        discard,
        `${BAT} に「git checkout -- ${path}」がありません。` +
          `このファイルはビルドが作り直すので、残っていると次回の git pull が中断します。`,
      ).toBeGreaterThan(-1);

      // `echo [1/5] git pull` の行を拾わないよう、行頭のコマンドだけを見る
      // （進捗表示の echo は checkout より前にあるので、素の indexOf だと必ず誤判定する）
      const pull = script.search(/^git pull\b/m);
      expect(pull, `${BAT} に git pull コマンドがありません`).toBeGreaterThan(-1);
      expect(
        discard,
        `「git checkout -- ${path}」が git pull より後にあります。順番が逆です。`,
      ).toBeLessThan(pull);
    });
  }

  it("捨てるときはエラーを握りつぶす（未変更でも止まらない）", () => {
    // `git checkout --` は対象が綺麗なときも成功するが、
    // パスが存在しない環境（フォークで構成が違う等）では失敗する。
    // そこでスクリプト全体が止まらないよう 2>nul を付ける。
    for (const path of GENERATED_ARTIFACTS) {
      expect(script).toMatch(
        new RegExp(`git checkout -- ${path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} 2>nul`),
      );
    }
  });

  it("生成物であることが CLAUDE.md にも書いてある（説明と実装の一致）", () => {
    // 「なぜ捨ててよいのか」の根拠。ここが食い違うと、次に読む人が
    // 「勝手に変更を捨てている」と誤解して外しかねない。
    const claude = readFileSync("CLAUDE.md", "utf8");
    expect(claude).toMatch(/supabase\/functions\/mcp\/index\.ts.*再生成|再生成.*supabase\/functions\/mcp\/index\.ts/s);
  });

  it("versionCode / versionName は書き換えない（手作業の領分を侵さない）", () => {
    // 版数の更新は Windows での手作業（mem/features/android-ci.md）。
    // ここで自動化すると、Play Console の実績とずれても気づけない。
    expect(script).not.toMatch(/versionCode\s*=|versionName\s*=/);
  });
});
