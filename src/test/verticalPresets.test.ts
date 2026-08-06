import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

// 業種プリセット（mem/ops/vertical-presets/*.vertical.ja.json）の番人。
//
// プリセットは兄弟アプリの src/locales/vertical.ja.json に丸ごとコピーする「値の束」で、
// 上流（GymBoard）に置いて上流で守る（mem/ops/vertical-presets/README.md）。
//
// 守りたいのは1点:
//   **上流が文言キーをリネーム/削除したとき、プリセットが古くなったことに気づけること。**
// 気づけないと、フォークが古いキーを上書きしても i18next は黙って無視するので、
// 「オーバーレイを当てたのにジムの語彙が出たまま」という形で静かに壊れる。

const PRESET_DIR = "mem/ops/vertical-presets";
const BASE_PATH = "src/locales/ja.json";

type Node = Record<string, unknown>;

function presetFiles(): string[] {
  return readdirSync(PRESET_DIR).filter((f) => f.endsWith(".vertical.ja.json"));
}

function readJson(path: string): Node {
  return JSON.parse(readFileSync(path, "utf8")) as Node;
}

/** オーバーレイの各葉が base に同じ形で存在するか検査し、ズレを列挙する */
function findStalePaths(overlay: Node, base: Node, prefix = ""): string[] {
  const stale: string[] = [];
  for (const [key, value] of Object.entries(overlay)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in base)) {
      stale.push(`${path}（base に無い）`);
      continue;
    }
    const baseValue = (base as Record<string, unknown>)[key];
    const overlayIsBranch = isPlainObject(value);
    const baseIsBranch = isPlainObject(baseValue);
    if (overlayIsBranch !== baseIsBranch) {
      stale.push(`${path}（base と形が違う: ${shape(baseValue)} vs ${shape(value)}）`);
      continue;
    }
    if (overlayIsBranch) {
      stale.push(...findStalePaths(value as Node, baseValue as Node, path));
    } else if (Array.isArray(value) !== Array.isArray(baseValue)) {
      stale.push(`${path}（base と形が違う: ${shape(baseValue)} vs ${shape(value)}）`);
    }
  }
  return stale;
}

/** 配列は「葉」として扱う（i18next の returnObjects で丸ごと差し替わるため） */
function isPlainObject(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function shape(v: unknown): string {
  if (Array.isArray(v)) return "配列";
  if (isPlainObject(v)) return "オブジェクト";
  return typeof v;
}

describe("業種プリセット", () => {
  const base = readJson(BASE_PATH);
  const files = presetFiles();

  it("プリセットが1つ以上ある（空ディレクトリで素通りしない）", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain("personal-stretch.vertical.ja.json");
  });

  it.each(presetFiles())("%s のキーが ja.json に実在する", (file) => {
    const overlay = readJson(`${PRESET_DIR}/${file}`);
    const stale = findStalePaths(overlay, base);
    expect(
      stale,
      stale.length
        ? `プリセットが上流の ja.json とズレています。` +
          `\n（このキーを上書きしても i18next は黙って無視するので、` +
          `フォークでは「オーバーレイを当てたのに元の文言が出る」形で壊れます）\n` +
          stale.map((s) => `  - ${s}`).join("\n") +
          `\n\n対処: ${PRESET_DIR}/${file} を今の ja.json のキーに合わせて直す。`
        : undefined,
    ).toEqual([]);
  });

  it("プリセットは空でない（コピー漏れの検出）", () => {
    for (const file of files) {
      const overlay = readJson(`${PRESET_DIR}/${file}`);
      expect(Object.keys(overlay).length, `${file} が空です`).toBeGreaterThan(0);
    }
  });

  // 🔴 かつてここに「姿勢分析の area は上流と同じ文字列のまま」という検査があった。
  //
  // `TrainingRecommendationCard` が **日本語のカテゴリ名を連想配列のキー**にして
  // 推奨種目を引いていたため、プリセット側で `area` を書き換えると突き合わせが外れ、
  // **エラーも出さずに推奨だけ消えた**。その事故を防ぐために
  // 「業種オーバーレイで area を変えてはいけない」という制約を課していた。
  //
  // **2026-08-06、照合を `categoryKey`（翻訳しない安定キー）に移したので、
  // この制約は不要になった。** プリセットは `area` を自由に業種の言葉にしてよい。
  // 突き合わせの不変条件は `src/test/postureI18n.test.ts` が見張る。
  //
  // ⚠️ **検査を消すのではなく、制約が消えたことを記録している。**
  //    次に「area を変えたら壊れるのでは」と思った人が、ここで経緯を辿れるように。
});
