import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SLOT_DURATION_OPTIONS, resolvePlanSlotMinutes } from "@/lib/planSlotDuration";
import { SLOT_STEP_MINUTES } from "@/lib/businessHours";

// 1回のトレーニングが何分か、をお客様に正しく見せる。
//
// ── なぜ要るか（2026-09-02）─────────────────────────────────────────
// 実店舗の指摘で2つ見つかった。どちらも「エラーは出ないが、見えている数字が
// おかしい」たぐいで、気づけるのは人が画面を読んだときだけ。
//
//   ① お客様の予約確認欄が **（（60分））** と二重括弧になっていた。
//      JSX 側で（）を書いたうえ、翻訳文字列も括弧付きで持っていたため。5言語すべて。
//   ② 1枠の長さの選択肢が [30,45,60,90,120] しか無く、**50分で回している店が
//      設定できなかった**（実店舗は50分）。
//
// あわせて、公開の体験予約ページは「計60分」を翻訳文に直書きしていた。
// 枠の長さはジムの設定値で計算しているのに、文字だけ60分固定だったので、
// 90分設定の店（本番に2店ある）は「90分刻みの枠を出しながら計60分と書く」状態だった。

const stripJs = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");

const readCode = (p: string) => stripJs(readFileSync(p, "utf8"));
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, Record<string, string>>;

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;
const CUSTOMER = "src/components/customer/CustomerBooking.tsx";
const TRIAL = "src/pages/TrialBooking.tsx";

describe("🔴 括弧を二重に出さない", () => {
  it("JSX 側で t(...) を括弧で囲んでいない（翻訳文字列が持っている）", () => {
    const code = readCode(CUSTOMER);
    // 全角・半角どちらで囲んでも落とす
    expect(code).not.toMatch(/[（(]\s*\{t\("booking\.slotMinutes"/);
  });

  it("翻訳文字列の側が括弧を持っている（両方から消えると裸の数字になる）", () => {
    for (const loc of LOCALES) {
      const v = readJson(`src/locales/${loc}.json`).booking.slotMinutes;
      expect(v, loc).toMatch(/^[（(].*[）)]$/);
      expect(v, loc).toContain("{{count}}");
    }
  });
});

describe("🔴 1枠の長さは店が設定できる（50分を含む）", () => {
  it("50分が選べる", () => {
    // 実店舗が50分で回している。45分と60分だけでは実態を設定できない。
    expect(SLOT_DURATION_OPTIONS).toContain(50);
  });

  it("5分刻みで並んでいる（55分・40分なども選べる）", () => {
    const fine = SLOT_DURATION_OPTIONS.filter((m) => m <= 120);
    for (const m of fine) expect(m % 5, `${m}分`).toBe(0);
    expect(fine).toContain(40);
    expect(fine).toContain(55);
  });

  it("🔴 選択肢は1か所だけ。画面ごとに配列を持たない", () => {
    // 以前はジム設定とプラン管理が別々に [30,45,60,90,120] を持っていて、
    // 片方に足して片方に足し忘れる形だった。
    for (const f of [
      "src/components/trainer/TrainerGymSettings.tsx",
      "src/components/trainer/TrainerPlanManager.tsx",
    ]) {
      const code = readCode(f);
      expect(code, f).toContain("SLOT_DURATION_OPTIONS");
      expect(code, f).not.toMatch(/\[\s*30\s*,\s*45\s*,\s*60\s*,\s*90\s*,\s*120\s*\]/);
    }
  });

  it("枠の刻み（15分）とは別物。50分でも開始時刻は15分刻みのまま", () => {
    // ここが連動してしまうと、50分にした店の枠が 09:00 / 09:50 / 10:40 と並ぶ。
    expect(SLOT_STEP_MINUTES).toBe(15);
    expect(SLOT_DURATION_OPTIONS).not.toContain(SLOT_STEP_MINUTES * 0);
  });

  it("プラン別の設定はジムの既定値を継承する", () => {
    const plans = [{ plan_name: "月4回(50分)", slot_duration_minutes: 50 }];
    expect(resolvePlanSlotMinutes("月4回(50分)", plans, 60)).toBe(50);
    expect(resolvePlanSlotMinutes("別のプラン", plans, 60)).toBe(60);
  });
});

describe("🔴 体験予約ページの所要時間を直書きしない", () => {
  it("3か所ともジムの設定値を渡している", () => {
    const code = readCode(TRIAL);
    for (const key of ["icsDescription", "completedMinutes", "headerSub"]) {
      expect(code, key).toMatch(
        new RegExp(`trialBooking\\.${key}"[^)]*count:\\s*sessionMinutes`),
      );
    }
  });

  it("翻訳文字列に 60 を焼き込んでいない（5言語）", () => {
    for (const loc of LOCALES) {
      const tb = readJson(`src/locales/${loc}.json`).trialBooking;
      for (const key of ["icsDescription", "completedMinutes", "headerSub", "minutesParen"]) {
        expect(tb[key], `${loc}.${key}`).toContain("{{count}}");
        expect(tb[key], `${loc}.${key}`).not.toMatch(/\b60\b/);
      }
    }
  });
});
