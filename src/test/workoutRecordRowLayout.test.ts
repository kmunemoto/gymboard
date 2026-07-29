import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// スマホで種目名が1文字ずつ縦に積まれた不具合（顧客詳細 > 記録 > 過去の記録）の回帰。
//
// 原因は break-all ではなく**幅が0まで潰れること**だった。日本語は word-break:normal でも
// 文字単位で折り返せるので、break-all を外しただけでは縦積みは止まらない。
// 横一列の flex で兄弟が全部 shrink-0 だと、唯一伸縮する種目名に負の余白が全部乗る。
// そこに min-w-0 が付いていると min-content の下限まで外れ、幅が 0px に張り付く。
// 幅0の箱からはみ出した文字が隣のセット文字列に重なり、「ワ10kg×15 / ...」と読めていた。
//
// jsdom は CSS を評価しないため描画テストでは検出できない。ソースの構造で見張る。

const TARGET = "src/components/trainer/TrainerClientDetail.tsx";

describe("過去の記録の行レイアウト", () => {
  /** 「過去の記録」1件分の行のソースを切り出す（同ファイルの要約チップと取り違えないため）。 */
  const recordRow = (): string => {
    const src = readFileSync(TARGET, "utf8");
    const start = src.indexOf('<div key={r.id} className="flex items-start gap-2 text-sm');
    expect(start, "過去の記録の行が見つからない").toBeGreaterThan(-1);
    const end = src.indexOf("</div>", src.indexOf("<Trash2", start));
    return src.slice(start, end);
  };

  it("種目名は行の全幅を受け取れる（flex-1 min-w-0 のラッパーの中にある）", () => {
    const row = recordRow();
    const nameIdx = row.indexOf("{r.exercise_name}");
    expect(nameIdx, "行に種目名の描画が無い").toBeGreaterThan(-1);

    // 種目名の手前にラッパーがあること。横一列に直接置くと兄弟に幅を全部持っていかれる。
    const before = row.slice(0, nameIdx);
    expect(before, "種目名が flex-1 min-w-0 のラッパーに入っていない").toMatch(/flex-1[^"]*min-w-0|min-w-0[^"]*flex-1/);
  });

  it("セット文字列が種目名と横幅を奪い合わない（nowrap と shrink-0 を併用しない）", () => {
    // セットを whitespace-nowrap shrink-0 で行に直接並べると 150〜190px を固定で奪う。
    // nowrap は「1セットが途中で割れない」ためだけに使い、shrink-0 とは併用しない。
    expect(recordRow()).not.toMatch(/whitespace-nowrap[^"]*shrink-0|shrink-0[^"]*whitespace-nowrap/);
  });

  it("break-all と min-w-0 を同じ要素に付けない（src 全体）", () => {
    // この2つが揃うと「幅0まで潰れたうえで1文字ずつ改行する」という最悪の組み合わせになる。
    // 日本語では break-all はほぼ不要（normal でも文字単位で折り返せる）で、
    // 英数字を割りたいだけなら break-words で足りる。
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!file.endsWith(".tsx") || file.startsWith("src/test/")) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/className="([^"]*)"/g)) {
          const cls = m[1];
          if (/\bbreak-all\b/.test(cls) && /\bmin-w-0\b/.test(cls)) {
            offenders.push(`${file}:${i + 1}  ${cls}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
