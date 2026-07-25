import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { devLog } from "@/lib/devLog";

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

afterEach(() => vi.restoreAllMocks());

describe("devLog（開発時だけ出るログ）", () => {
  it("開発時は console.log に流す", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    devLog("hello", 1);
    // vitest は import.meta.env.DEV が true
    expect(spy).toHaveBeenCalledWith("hello", 1);
  });

  it("src 配下に生の console.log が残っていない", () => {
    // 生の console.log は、お客様の名前・予約内容・トレーニング記録をブラウザの
    // コンソールに出しうる。vite.config の pure 指定により本番ビルドでは除去されるが、
    // build:dev の検証ビルドや、pure 設定が外れた瞬間にそのまま漏れる。
    // 判定を import.meta.env.DEV として明示した devLog に寄せる。
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.tsx?$/.test(file)) continue;
      if (file === "src/lib/devLog.ts" || file.startsWith("src/test/")) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        if (line.includes("console.log(")) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(
      offenders,
      offenders.length
        ? `console.log ではなく devLog を使ってください（@/lib/devLog）:\n${offenders.join("\n")}`
        : undefined,
    ).toEqual([]);
  });

  it("障害調査用の console.warn / console.error は残っている", () => {
    // devLog への置き換えで、本番でも必要な失敗ログまで消してしまっていないことの確認
    let warnOrError = 0;
    for (const file of walk("src")) {
      if (!/\.tsx?$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      warnOrError += (src.match(/console\.(warn|error)\(/g) ?? []).length;
    }
    expect(warnOrError).toBeGreaterThan(20);
  });
});
