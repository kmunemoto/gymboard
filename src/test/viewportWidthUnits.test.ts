/**
 * iPad で、アプリに戻ると中身だけが左に細く寄る（2026-11-26 宗本さんの iPad のスクショ）。
 *
 * 原因: index.css が html・body・#root の幅を `max-width: 100vw` で抑えていた。iPad のアプリ
 * （WKWebView）は、アプリに戻ったときに **vw（画面の幅の単位）だけが古い幅（約480pt）のまま**
 * 残ることがある。メディアクエリ（md: 以上でサイドバーを出す）は本当の幅（810pt）で効いていたので、
 * サイドバーと画面に固定のヘッダーは普通に出て、中身だけが 480 − 240（サイドバー）の幅に押し込まれた
 * （ブラウザで html・body・#root を 480px に抑えると、スクショと同じ見た目になるのを確かめた）。
 *
 * 直し方: ページ全体の幅は vw で抑えない（ブロック要素は何もしなくても画面の幅いっぱいになる）。
 * メモ: mem/features/ipad-layout.md
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = stripCssComments(readFileSync("src/index.css", "utf8"));

/** `selector { ... }` の中身を全部（同じセレクタが何か所あっても）集める */
const blocksOf = (selector: RegExp) => {
  const out: string[] = [];
  const re = new RegExp(`(^|[\\s,}])(${selector.source})\\s*(,[^{]*)?\\{([^}]*)\\}`, "gm");
  for (const m of CSS.matchAll(re)) out.push(m[4]);
  return out;
};

describe("🔴 ページ全体の幅を vw で決めない（iPad で vw だけ古い幅のまま残る）", () => {
  it.each([
    ["html", /html/],
    ["body", /body/],
    ["#root", /#root/],
  ])("%s の幅（width・max-width・min-width）に vw を使っていない", (name, selector) => {
    const blocks = blocksOf(selector);
    expect(blocks.length, `${name} のルールが見つからない`).toBeGreaterThan(0);
    for (const b of blocks) {
      expect(b, name).not.toMatch(/(?:^|[;\s])(?:max-|min-)?width\s*:[^;]*\d+(?:\.\d+)?d?s?l?vw/);
    }
  });

  it("横にはみ出さない守り（overflow-x: hidden と max-width: 100%）は残している", () => {
    const rootLike = [...blocksOf(/html/), ...blocksOf(/body/), ...blocksOf(/#root/)].join("\n");
    expect(rootLike).toMatch(/overflow-x:\s*hidden/);
    expect(rootLike).toMatch(/max-width:\s*100%/);
  });

  it("index.css のどこにも 100vw が無い", () => {
    expect(CSS).not.toMatch(/100\s*vw/);
  });

  it("オーナー・お客様の画面の外枠に w-screen・100vw を使っていない", () => {
    for (const f of ["src/components/trainer/TrainerView.tsx", "src/components/customer/CustomerView.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\bw-screen\b|max-w-\[100vw\]|w-\[100vw\]/);
    }
  });
});
