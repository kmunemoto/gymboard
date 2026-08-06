import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import type { PostureCategoryKey } from "@/components/customer/posture/types";

// 姿勢解析エンジンが**文言を持たない**ことと、推奨種目の突き合わせが
// **翻訳されないキー**で行われることの検査。
//
// ── なぜ要るか ──────────────────────────────────────────────────
// 1. エンジン（postureAnalysis.ts）に日本語が直書きされていると、
//    **業種オーバーレイが届かない**。ロケールに載っている文言しか差し替えられないため。
//    ピラティススタジオや整骨院のお客様に「ルーマニアンデッドリフト」「フェイスプル」
//    のような**器具（バーベル・ケーブル）が要る種目**がそのまま出ていた。
//
// 2. 推奨種目の突き合わせに**表示文字列**を使っていると、文言を i18n 化して
//    オーバーレイで差し替えた瞬間に**照合が黙って外れ、推奨だけが消える**。
//    エラーは出ない。**D と E をセットで直す必要があったのはこのため**
//    （E だけ先に i18n 化すると、その瞬間に壊れる）。
//
// ── 変異テスト（2026-08-06 実施・5件とも赤を確認）────────────────
//   1. エンジンに日本語の message を1つ戻す              → 赤
//   2. 照合キーを categoryKey から日本語に戻す            → 赤
//   3. ロケールの messages を1つ消す                      → 赤
//   4. ロケールの exercises を1つ消す                     → 赤
//   5. DiagnosisHistorySection に直書きの種目を戻す        → 赤

const ENGINE = "src/components/customer/posture/postureAnalysis.ts";
const CARD = "src/components/customer/posture/TrainingRecommendationCard.tsx";
const HISTORY = "src/components/customer/posture/DiagnosisHistorySection.tsx";
const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;

const CATEGORY_KEYS: PostureCategoryKey[] = [
  "forwardHead",
  "shoulderTilt",
  "roundedBack",
  "pelvicTilt",
  "legAlignment",
  "weightShift",
  "overall",
];

/** コメントを落としたソース（説明文の日本語を拾わないため） */
const codeOf = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const readLocale = (loc: string) =>
  JSON.parse(readFileSync(`src/locales/${loc}.json`, "utf8"));

describe("姿勢解析エンジンは文言を持たない", () => {
  it("postureAnalysis.ts に日本語のリテラルが無い", () => {
    const code = codeOf(ENGINE);
    const jp = code.match(/[ぁ-んァ-ヶ一-龠]+/g) ?? [];
    expect(
      jp,
      `エンジンに日本語が直書きされています。業種オーバーレイが届かず、` +
        `フォークのお客様に複製元の種目（バーベル種目など）がそのまま出ます: ${jp.join(", ")}`,
    ).toEqual([]);
  });

  it("エンジンが categoryKey / messageKey を返している（空振り防止）", () => {
    const code = codeOf(ENGINE);
    expect(code).toMatch(/categoryKey:/);
    expect(code).toMatch(/messageKey:/);
    // 旧フィールドが残っていたら移行が中途半端
    expect(code, "旧 category: が残っています").not.toMatch(/\bcategory:\s*"/);
    expect(code, "旧 message: が残っています").not.toMatch(/\bmessage:\s*[`"]/);
  });

  it("エンジンが返す messageKey / exerciseKeys が全ロケールに揃っている", () => {
    const code = codeOf(ENGINE);
    const messageKeys = [...code.matchAll(/messageKey: "([^"]+)"/g)].map((m) => m[1]);
    const exerciseKeys = [
      ...code.matchAll(/exerciseKeys: \[([^\]]+)\]/g),
    ].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));

    expect(messageKeys.length, "messageKey が1つも見つかりません").toBeGreaterThan(10);

    for (const loc of LOCALES) {
      const a = readLocale(loc).posture?.analysis;
      expect(a, `${loc}.json に posture.analysis がありません`).toBeTruthy();
      for (const k of new Set(messageKeys)) {
        expect(a.messages?.[k], `${loc}.json に posture.analysis.messages.${k} がありません`).toBeTruthy();
      }
      for (const k of new Set(exerciseKeys)) {
        expect(a.exercises?.[k], `${loc}.json に posture.analysis.exercises.${k} がありません`).toBeTruthy();
      }
      for (const k of CATEGORY_KEYS) {
        expect(a.categories?.[k], `${loc}.json に posture.analysis.categories.${k} がありません`).toBeTruthy();
      }
    }
  });

  it("{{side}} を使うメッセージは、エンジンが sideKey を渡している", () => {
    const ja = readLocale("ja").posture.analysis.messages as Record<string, string>;
    const needsSide = Object.entries(ja)
      .filter(([, v]) => v.includes("{{side}}"))
      .map(([k]) => k);
    expect(needsSide.length, "{{side}} を使うメッセージが1つもありません").toBeGreaterThan(0);

    const code = codeOf(ENGINE);
    for (const k of needsSide) {
      // messageKey: "xxx", sideKey, の形になっているか
      const re = new RegExp(`messageKey: "${k}",\\s*sideKey`);
      expect(
        re.test(code),
        `${k} は {{side}} を使うのに、エンジンが sideKey を渡していません（空欄で表示されます）`,
      ).toBe(true);
    }
  });
});

describe("推奨種目の突き合わせは翻訳されないキーで行う", () => {
  it("TrainingRecommendationCard が categoryKey で引いている", () => {
    const code = codeOf(CARD);
    expect(code).toMatch(/POSTURE_EXERCISES\[fb\.categoryKey\]/);
    // 日本語をキーにした連想配列に戻っていないこと
    const jpKeys = code.match(/"[ぁ-んァ-ヶ一-龠][^"]*":\s*t\(/g) ?? [];
    expect(
      jpKeys,
      `表示文字列を照合キーに使っています。i18n で文言を差し替えた瞬間に` +
        `照合が外れ、エラーも出ないまま推奨が消えます: ${jpKeys.join(", ")}`,
    ).toEqual([]);
  });

  it("引いているキーが PostureCategoryKey に含まれる", () => {
    const code = codeOf(CARD);
    const block = code.slice(code.indexOf("POSTURE_EXERCISES"), code.indexOf("postureTips"));
    const keys = [...block.matchAll(/^\s{4}(\w+):\s*t\(/gm)].map((m) => m[1]);
    expect(keys.length, "POSTURE_EXERCISES のキーを読めません").toBeGreaterThan(0);
    for (const k of keys) {
      expect(
        CATEGORY_KEYS.includes(k as PostureCategoryKey),
        `POSTURE_EXERCISES の "${k}" は PostureCategoryKey にありません（永久に一致しません）`,
      ).toBe(true);
    }
  });
});

describe("推奨種目がロケール外に直書きされていない", () => {
  it("DiagnosisHistorySection が種目を直書きしていない", () => {
    // 以前は TrainingRecommendationCard と同じ内容を日本語で複製して持っており、
    // **この画面だけ複製元の種目が出たまま**になっていた。
    // この画面はお客様の設定画面とトレーナーのカルテの両方に出る。
    const code = codeOf(HISTORY);
    expect(code, "TRAINING_TIPS の直書きが復活しています").not.toMatch(/TRAINING_TIPS\s*[:=]/);
    expect(code).toMatch(/posture\.recommendation\.types\./);
  });

  it("ロケールから引いた推奨が実際に取れる（空振り防止）", () => {
    for (const type of ["straight", "wave", "natural"]) {
      const tips = i18n.t(`posture.recommendation.types.${type}.tips`, {
        returnObjects: true,
      }) as { area: string; exercises: string[] }[];
      expect(Array.isArray(tips), `${type} の tips が配列ではありません`).toBe(true);
      expect(tips.length, `${type} の tips が空です`).toBeGreaterThan(0);
      expect(tips[0].exercises.length).toBeGreaterThan(0);
    }
  });
});
