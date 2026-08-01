import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// scripts/extract-vertical-overlay.mjs の回帰テスト。
//
// このスクリプトは、兄弟アプリが直接書き換えてしまった ja.json から
// 業種オーバーレイを抜き出す「一度きりだが失敗が許されない」移行ツール。
// 抜き出しを間違えると、上流を取り込んだ瞬間に業種語彙が消える
// （mem/ops/vertical-fork.md「すでに ja.json を直接書き換えてしまったフォークの直し方」）。
//
// 特に大事なのは、**オーバーレイで表現できないもの**（フォークが削除したキー・
// 追加したキー）を握り潰さずに警告すること。黙って落とすと、移行後に
// 「なぜかこのキーだけジムの文言が出る」という追跡困難な形で表面化する。

const SCRIPT = "scripts/extract-vertical-overlay.mjs";
const dir = mkdtempSync(join(tmpdir(), "overlay-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

let seq = 0;

/**
 * スクリプトを実行し、書き出したオーバーレイと警告ログ（stderr）を返す。
 * 警告は stderr にしか出ないので、stdout を捨てて stderr だけを拾う。
 */
function run(upstream: unknown, fork: unknown): { overlay: Record<string, unknown>; log: string } {
  const n = seq++;
  const up = join(dir, `up${n}.json`);
  const fk = join(dir, `fork${n}.json`);
  const out = join(dir, `out${n}.json`);
  writeFileSync(up, JSON.stringify(upstream));
  writeFileSync(fk, JSON.stringify(fork));
  const log = execFileSync("bash", ["-c", `node ${SCRIPT} ${up} ${fk} ${out} 2>&1 >/dev/null`], {
    encoding: "utf8",
  });
  return { overlay: JSON.parse(readFileSync(out, "utf8")), log };
}

describe("業種オーバーレイの抽出スクリプト", () => {
  it("値が違う葉だけを、入れ子構造を保って抜き出す", () => {
    const { overlay } = run(
      { nav: { home: "ホーム", training: "記録" }, common: { ok: "OK" } },
      { nav: { home: "ホーム", training: "施術記録" }, common: { ok: "OK" } },
    );
    // 変えた training だけが出る。同じ home / ok は出さない（出すと衝突源が増える）
    expect(overlay).toEqual({ nav: { training: "施術記録" } });
  });

  it("上流と完全に同じなら空のオーバーレイになる", () => {
    const base = { a: { b: "x" }, c: "y" };
    const { overlay } = run(base, JSON.parse(JSON.stringify(base)));
    expect(overlay).toEqual({});
  });

  it("配列は要素ごとではなく丸ごと差し替える（returnObjects で引かれるため）", () => {
    const { overlay } = run(
      { tips: ["プランク", "スクワット"], other: "同じ" },
      { tips: ["大胸筋ストレッチ", "スクワット"], other: "同じ" },
    );
    expect(overlay).toEqual({ tips: ["大胸筋ストレッチ", "スクワット"] });
  });

  it("フォークが削除したキーを警告する（オーバーレイでは表現できない）", () => {
    const { log } = run({ nav: { home: "ホーム", training: "記録" } }, { nav: { home: "ホーム" } });
    expect(log).toContain("フォークが削除したキー");
    expect(log).toContain("nav.training");
  });

  it("フォークが追加したキーを警告する（i18next が黙って無視する）", () => {
    const { log } = run({ nav: { home: "ホーム" } }, { nav: { home: "ホーム", extra: "独自" } });
    expect(log).toContain("フォークが追加したキー");
    expect(log).toContain("nav.extra");
  });

  // Phase 0-A より前の世代のフォークは、製品名がロケールに**リテラルで**入っている。
  // 上流は `{{brandJa}}` に追い出しているので値が違い、機械的には「フォークが変えた葉」に
  // 見えるが、これを写すと brand.ts からの注入が効かなくなる（＝Phase 0-A が死ぬ）。
  // セッコツボードで実際に26葉が紛れ込んだ（2026-08-01）。
  it("上流がブランド補間に追い出した葉はオーバーレイに入れない", () => {
    const { overlay, log } = run(
      {
        common: { brand: "{{brandJa}}", ok: "OK" },
        auth: { appTitle: "{{brandJa}}", tab: "オーナー" },
        nav: { training: "記録" },
      },
      {
        common: { brand: "セッコツボード", ok: "OK" },
        auth: { appTitle: "セッコツボード", tab: "院オーナー" },
        nav: { training: "施術記録" },
      },
    );
    // 製品名の葉は落ちる。業種語彙の葉だけが残る。
    expect(overlay).toEqual({ auth: { tab: "院オーナー" }, nav: { training: "施術記録" } });
    expect(log).toContain("ブランド補間の葉");
    expect(log).toContain("common.brand");
    expect(log).toContain("auth.appTitle");
  });

  it("形が変わったキーを警告し、オーバーレイには入れない", () => {
    const { overlay, log } = run({ brand: "ジムボード" }, { brand: { nested: "x" } });
    expect(log).toContain("形が変わったキー");
    expect(overlay).toEqual({});
  });

  // 実物での往復確認。ja.json にプリセットを重ねたものを「フォーク」とみなして
  // 抜き出すと、プリセットの差分がそのまま戻ってくること。
  it("実際の ja.json とプリセットで往復する", () => {
    const base = JSON.parse(readFileSync("src/locales/ja.json", "utf8"));
    const preset = JSON.parse(
      readFileSync("mem/ops/vertical-presets/personal-stretch.vertical.ja.json", "utf8"),
    );
    const deepMerge = (b: Record<string, unknown>, o: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(o)) {
        const bv = b[k];
        if (v && typeof v === "object" && !Array.isArray(v) && bv && typeof bv === "object" && !Array.isArray(bv)) {
          deepMerge(bv as Record<string, unknown>, v as Record<string, unknown>);
        } else b[k] = v;
      }
    };
    const fork = JSON.parse(JSON.stringify(base));
    deepMerge(fork, preset);

    const { overlay, log } = run(base, fork);

    // 上流と同じ値のままのキー（プリセットが意図的に据え置いている area など）は
    // 差分ではないので出てこない。それ以外はプリセットと一致する。
    const flatten = (o: Record<string, unknown>, p = ""): Record<string, string> => {
      const acc: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) {
        const q = p ? `${p}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(acc, flatten(v as Record<string, unknown>, q));
        else acc[q] = JSON.stringify(v);
      }
      return acc;
    };
    const got = flatten(overlay);
    const want = flatten(preset);
    // 抽出結果に「プリセットに無いもの」が混ざっていないこと
    expect(Object.keys(got).filter((k) => !(k in want))).toEqual([]);
    // プリセットのうち抽出されなかったものは、上流と同値のものだけであること
    for (const k of Object.keys(want).filter((key) => !(key in got))) {
      const flatBase = flatten(base);
      expect(flatBase[k], `${k} は上流と同値でないのに抽出されていない`).toBe(want[k]);
    }
    // 実物では削除も追加もしていないので警告は出ない
    expect(log).not.toContain("フォークが削除したキー");
    expect(log).not.toContain("フォークが追加したキー");
  });
});
