import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// トレーナーの記録入力で「種目を追加する」を押すとページ先頭まで飛ぶ不具合の再発防止
// （2026-08-23 実機報告）。iOS でキーボードの収納（WebView のリサイズ）と追加時の
// 再レンダーが重なるとスクロールが先頭へ戻るため、追加後に**追加した種目カードへ
// 明示的にスクロールして着地させる**。ここではその配線をソースで固定する。
describe("記録入力: 種目追加後に追加カードへスクロールする", () => {
  const src = readFileSync("src/components/trainer/TrainerClientDetail.tsx", "utf8");

  it("addExercise が追加した種目カードへ scrollIntoView する", () => {
    // 追加前の件数 = 新カードの index を先に取ってから追加する
    expect(src).toMatch(/const nextIndex = exercises\.length;/);
    // 描画とキーボード収納が落ち着くのを待ってからスクロール（即時だと巻き戻される）
    expect(src).toMatch(
      /setTimeout\(\(\) => \{\s*\n\s*document\.getElementById\(`training-exercise-\$\{nextIndex\}`\)\?\.scrollIntoView\(/,
    );
  });

  it("種目カード側に対応する id が付いている", () => {
    expect(src).toMatch(/id=\{`training-exercise-\$\{i\}`\}/);
  });
});
