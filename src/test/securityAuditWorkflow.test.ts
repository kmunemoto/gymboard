/**
 * 定期セキュリティ点検の台本（2026-11-01・宗本さん「保存しておいて、点検をたまに回して」）。
 *   `.claude/workflows/gymboard-security-audit.js`・`mem/ops/security-audit.md`
 *
 * 月1回の予定がこの台本を名前（見つからなければファイルのパス）で回す。台本が壊れていると、点検は黙って動かない。
 * リポジトリは公開なので、ジムの ID・秘密の値を台本に書かないことも見張る。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const PATH = ".claude/workflows/gymboard-security-audit.js";
const src = readFileSync(PATH, "utf8");
const memo = readFileSync("mem/ops/security-audit.md", "utf8");

describe("定期点検の台本", () => {
  it("構文が正しい（Workflow と同じく、async の本体として読める）", () => {
    expect(src.startsWith("export const meta = {")).toBe(true);
    const body = src.replace(/^export const meta =/, "const meta =");
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => unknown;
    expect(() => new AsyncFunction("args", "agent", "pipeline", "parallel", "log", "phase", body)).not.toThrow();
  });

  it("メモ（と予定）が呼ぶ名前・パスと一致する", () => {
    expect(src).toMatch(/^export const meta = \{\n {2}name: 'gymboard-security-audit',/);
    expect(memo).toContain('Workflow({ name: "gymboard-security-audit"');
    expect(memo).toContain(`Workflow({ scriptPath: "${PATH}"`);
  });

  it("phase の名前が meta.phases と一致する（進み具合の表示がずれない）", () => {
    const declared = [...src.matchAll(/\{ title: '([^']+)'/g)].map((m) => m[1]).sort();
    const used = [...new Set([...src.matchAll(/phase: '([^']+)'/g)].map((m) => m[1]))].sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(used).toEqual(declared);
  });

  it("再開を壊す呼び出し（Date.now・Math.random・引数なしの new Date）を使っていない", () => {
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(|new Date\(\)/);
  });

  it("🔴 公開リポジトリ: ID・鍵を書いていない", () => {
    expect(src).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(src).not.toMatch(/\b(sk|rk|whsec)_(live|test)?_?[A-Za-z0-9]{8,}/);
    expect(memo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("点検役は読むだけ・既知のものは記録を読んで外す・回帰は必ず挙げる", () => {
    expect(src).toContain("読むだけ。ファイルを変更しない");
    expect(src).toContain("INSERT / UPDATE / DELETE / DDL / 関数の実行・SET ROLE は禁止");
    expect(src).toContain("まず mem/ops/tenant-boundary.md");
    expect(src).toContain("回帰）なら、**必ず挙げる**");
  });

  it("指摘ごとに反証する（critical・high・回帰は観点を変えて2体）", () => {
    expect(src).toContain(
      "(f.severity === 'critical' || f.severity === 'high' || f.regression) ? [LENS_CODE, LENS_ATTACKER] : [LENS_CODE]",
    );
    expect(src).toContain("const ok = it.votes.filter((v) => v.verdict !== 'refuted')");
  });

  it("記録の表がある（次の点検の since に使う）", () => {
    expect(memo).toMatch(/\| 日付 \| 範囲 \| 体数 \| 指摘 \| 反証で落ちた \| 直したもの \|/);
    expect(memo).toMatch(/\| 2026-11-01 \|/);
  });
});
