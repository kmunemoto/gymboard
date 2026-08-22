import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// 時間帯を選ぶ設定の時刻セレクタは**すべて15分刻み**（2026-08-22 に統一）。
//
// 予約枠のグリッドが15分刻みのジム（実店舗）では、「18:15〜」のような境界を
// 指定できないと制限・帯の設定が実際の枠に合わせられない。
// 30分刻みに戻すと 18:15 / 19:30 のような値が選べなくなる（受付しない時間帯で
// 実際に踏んだ制約。bookingBlockedWindows.test.ts も参照）。
//
// ⚠️ 営業時間・シフトの設定は30分刻みのまま（開店・閉店時刻は30分単位で足りて
//    いるという判断。15分が必要になったらそのとき合わせる）。
//
// 判定ロジック（分単位の計算・DBトリガーの split_part）は刻みに依存しないので、
// この変更はUIの選択肢だけ。保存済みの30分刻みの値もそのまま選択肢に含まれる。

const TARGETS = [
  { file: "src/components/trainer/TrainerBookingLimits.tsx", fn: "limitTime", prefix: "LIMIT" },
  { file: "src/components/trainer/TrainerCapacityWindows.tsx", fn: "windowTime", prefix: "WINDOW" },
  { file: "src/components/trainer/TrainerBlockedWindows.tsx", fn: "windowTime", prefix: "WINDOW" },
];

describe("時間帯設定の時刻セレクタは15分刻み", () => {
  for (const { file, fn, prefix } of TARGETS) {
    const src = readFileSync(file, "utf8");

    it(`${file.split("/").pop()}: 15分×96個で生成している`, () => {
      expect(src).toMatch(new RegExp(`const total = i \\* 15;`));
      expect(src).not.toMatch(/const total = i \* 30;/);
      expect(src).toMatch(
        new RegExp(`${prefix}_START_OPTIONS = Array\\.from\\(\\{ length: 96 \\}, \\(_, i\\) => ${fn}\\(i\\)\\)`),
      );
      expect(src).toMatch(
        new RegExp(`${prefix}_END_OPTIONS = Array\\.from\\(\\{ length: 96 \\}, \\(_, i\\) => ${fn}\\(i \\+ 1\\)\\)`),
      );
    });

    it(`${file.split("/").pop()}: 刻み外の保存値も黙って丸めず表示する`, () => {
      // 過去にSQL直挿入等で入った値が消えたり丸まったりしない
      expect(src).toMatch(new RegExp(`!${prefix}_START_OPTIONS\\.includes\\(`));
      expect(src).toMatch(new RegExp(`!${prefix}_END_OPTIONS\\.includes\\(`));
    });
  }
});
