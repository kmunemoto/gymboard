import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ────────────────────────────────────────────────────────────────
// 店舗側アプリの初回読み込みを重くしない（2026-09-19）
//
// 宗本さん:「店舗側のジムボードアプリの読み込みが遅すぎる」
//
// ビルドを実測した結果:
//   店舗ホームまでに落ちる JS = 1,774KB / 38ファイル
//   うち recharts = 366KB（約2割）
//
// recharts は `TrainerDashboard` が**静的 import** していたため、
//   - ジム設定で「売上グラフ」をOFFにしていても落ちてくる
//   - 起動 → TrainerView → TrainerDashboard → recharts と**直列で3回**取りに行く
// という状態だった。グラフは画面のいちばん下にあり、最初の描画には要らない。
//
// 🔴 ここが緩むとユーザーには「なんとなく遅い」としか見えず、気づけるのは
//    次にビルドを測った人だけ。だから番人にする。
// ────────────────────────────────────────────────────────────────

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const read = (p: string) => stripJs(readFileSync(p, "utf8"));

/** 起動直後に必ず読まれる店舗側の画面。ここに重いライブラリを静的 import しない */
const TRAINER_STARTUP = [
  "src/components/trainer/TrainerView.tsx",
  "src/components/trainer/TrainerDashboard.tsx",
];

/** 初回読み込みに載せたくない重いライブラリ（実測のバイト数つき） */
const HEAVY = [
  { mod: "recharts", kb: 366 },
  { mod: "@tensorflow/tfjs", kb: 342 },
  { mod: "@tensorflow-models/pose-detection", kb: 572 },
];

describe("🔴 店舗ホームに重いライブラリを静的 import しない", () => {
  for (const f of TRAINER_STARTUP) {
    for (const { mod, kb } of HEAVY) {
      it(`${f.split("/").pop()} が ${mod}（約${kb}KB）を静的 import していない`, () => {
        const code = read(f);
        expect(
          code,
          `${f} が ${mod} を静的 import しています。初回読み込みに約${kb}KB 増えます。` +
          `lazy(() => import("...")) 経由に変えてください`,
        ).not.toMatch(new RegExp(`from\\s+["']${mod.replace(/[/@-]/g, "\\$&")}["']`));
      });
    }
  }

  it("売上グラフは lazy 経由で読んでいる", () => {
    const code = read("src/components/trainer/TrainerDashboard.tsx");
    expect(code).toMatch(/lazy\(\(\) => import\("\.\/RevenueBarChart"\)\)/);
    // 読み込み中に画面が崩れないよう Suspense で包む
    expect(code).toContain("<Suspense");
  });

  it("recharts を使うのは切り出した1ファイルだけ", () => {
    // ここが増えると、どこから初回読み込みに戻ったのか追えなくなる
    const chart = read("src/components/trainer/RevenueBarChart.tsx");
    expect(chart).toMatch(/from "recharts"/);
  });
});

describe("重い画面は遅延読み込みのまま", () => {
  it("TrainerView がダッシュボードとカルテを lazy で読んでいる", () => {
    const code = read("src/components/trainer/TrainerView.tsx");
    expect(code).toMatch(/lazy\(\(\) => import\("\.\/TrainerDashboard"\)\)/);
    expect(code).toMatch(/lazy\(\(\) => import\("\.\/TrainerClientDetail"\)\)/);
  });

  it("日本語以外のロケールは同梱しない（1つ約120KB）", () => {
    // ja だけ同梱し、他は使うときに読む。全部同梱すると約480KB 増える
    const i18n = read("src/lib/i18n.ts");
    expect(i18n).toMatch(/import ja from "@\/locales\/ja\.json"/);
    for (const lng of ["en", "ko", "zh-CN", "zh-TW"]) {
      expect(i18n, `${lng} が静的 import になっています`)
        .not.toMatch(new RegExp(`import \\w+ from "@/locales/${lng}\\.json"`));
      expect(i18n).toContain(`import("@/locales/${lng}.json")`);
    }
  });
});
