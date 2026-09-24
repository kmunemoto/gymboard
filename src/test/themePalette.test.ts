/**
 * テーマカラー 64色（2026-09-24 宗本さん「テーマカラーを64色にしてください」）。
 *
 * 🔴 壊しやすいもの:
 *   1. 以前からの6色の値が変わる → 選んでいた人の見た目が勝手に変わる
 *   2. 保存してある古い id（"teal" 等）が読めなくなる → 選んでいた色が既定に戻る
 *   3. 白い文字が読めない色が混ざる（ボタンに白い文字が乗る）
 *   4. 見分けのつかない2色が並ぶ（最初の案では、ティールの2色がほぼ同じだった）
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  THEME_FAMILIES, THEME_TONES, contrastWithWhite, hslTripleToOklab,
} from "@/lib/themePalette";
import {
  THEME_COLORS, LEGACY_COLORS, LEGACY_THEME_IDS, DEFAULT_THEME_ID,
  resolveThemeColorId, applyThemeColor, getStoredThemeColor, findThemeColor,
} from "@/lib/themeColor";

const LOCALES = ["ja", "en", "ko", "zh-CN", "zh-TW"] as const;

// 6色だったころの値（2026-09-24 までの themeColor.ts からそのまま写した）。ここは直さないこと。
const OLD_SIX: Record<string, [string, string, string]> = {
  teal: ["174 60% 45%", "174 63% 39%", "180 58% 41%"],
  blue: ["214 70% 48%", "210 80% 52%", "198 85% 55%"],
  violet: ["256 55% 56%", "262 70% 60%", "276 70% 64%"],
  rose: ["342 65% 53%", "346 78% 58%", "356 80% 62%"],
  amber: ["30 80% 50%", "36 90% 53%", "44 92% 55%"],
  green: ["150 50% 40%", "148 55% 44%", "138 55% 48%"],
};

const dist = (a: string, b: string) => {
  const x = hslTripleToOklab(a);
  const y = hslTripleToOklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

const isLegacy = (id: string) => Object.values(LEGACY_THEME_IDS).includes(id);

describe("64色", () => {
  it("16の色 × 4つのトーン。id は重ならない", () => {
    expect(THEME_FAMILIES).toHaveLength(16);
    expect(THEME_TONES).toHaveLength(4);
    expect(THEME_COLORS).toHaveLength(64);
    expect(new Set(THEME_COLORS.map((p) => p.id)).size).toBe(64);
    for (const f of THEME_FAMILIES) {
      for (const tone of THEME_TONES) {
        const p = findThemeColor(f.id, tone);
        expect(p.id).toBe(`${f.id}-${tone}`);
      }
    }
  });

  it("CSS に入れる値はすべて \"H S% L%\" の形", () => {
    for (const p of THEME_COLORS) {
      for (const v of Object.values(p.vars)) {
        expect(v, p.id).toMatch(/^\d{1,3} \d{1,3}% \d{1,3}%$/);
      }
    }
  });

  it("🔴 白い文字が読める（新しく作った58色: ボタンの色は 3:1 以上、グラデーションの終点は 2.5:1 以上）", () => {
    const low: string[] = [];
    for (const p of THEME_COLORS) {
      if (isLegacy(p.id)) continue;
      const primary = contrastWithWhite(p.vars["--primary"]);
      const accent = contrastWithWhite(p.vars["--accent"]);
      const accent2 = contrastWithWhite(p.vars["--accent-2"]);
      if (primary < 3 || accent < 3 || accent2 < 2.5) {
        low.push(`${p.id} primary=${primary.toFixed(2)} accent=${accent.toFixed(2)} accent2=${accent2.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it("🔴 どの2色も見分けられる（OKLab で 0.02 以上離れている）", () => {
    const close: string[] = [];
    for (let i = 0; i < THEME_COLORS.length; i++) {
      for (let j = i + 1; j < THEME_COLORS.length; j++) {
        const d = dist(THEME_COLORS[i].swatch, THEME_COLORS[j].swatch);
        if (d < 0.02) close.push(`${THEME_COLORS[i].id} ~ ${THEME_COLORS[j].id} (${d.toFixed(3)})`);
      }
    }
    expect(close).toEqual([]);
  });

  it("ディープは、どの色でもいちばん暗い", () => {
    for (const f of THEME_FAMILIES) {
      const l = (tone: (typeof THEME_TONES)[number]) => hslTripleToOklab(findThemeColor(f.id, tone).swatch)[0];
      for (const tone of ["vivid", "soft", "dusty"] as const) {
        expect(l("deep"), `${f.id} deep < ${tone}`).toBeLessThan(l(tone));
      }
    }
  });
});

describe("🔴 以前からの6色", () => {
  it("値が1文字も変わっていない", () => {
    expect(Object.keys(LEGACY_COLORS).sort()).toEqual(Object.keys(OLD_SIX).sort());
    for (const [family, [primary, accent, accent2]] of Object.entries(OLD_SIX)) {
      const p = THEME_COLORS.find((x) => x.id === LEGACY_THEME_IDS[family])!;
      expect(p, family).toBeTruthy();
      expect(p.vars["--primary"], family).toBe(primary);
      expect(p.vars["--accent"], family).toBe(accent);
      expect(p.vars["--accent-2"], family).toBe(accent2);
      expect(p.vars["--ring"], family).toBe(accent);
      expect(p.vars["--sidebar-primary"], family).toBe(primary);
      expect(p.vars["--sidebar-ring"], family).toBe(accent);
    }
  });

  it("保存してある古い id を読み替える（選んでいた色が既定に戻らない）", () => {
    for (const family of Object.keys(OLD_SIX)) {
      const id = resolveThemeColorId(family);
      expect(id).not.toBe(family);
      expect(THEME_COLORS.find((p) => p.id === id)!.family).toBe(family);
    }
  });

  it("既定は以前からのティールで、index.css の初期値と同じ（何も選んでいない人の見た目は変わらない）", () => {
    expect(DEFAULT_THEME_ID).toBe(LEGACY_THEME_IDS.teal);
    const css = readFileSync("src/index.css", "utf8");
    const def = THEME_COLORS.find((p) => p.id === DEFAULT_THEME_ID)!;
    for (const k of ["--primary", "--accent", "--accent-2"]) {
      expect(css, k).toContain(`${k}: ${def.vars[k]};`);
    }
  });
});

describe("保存と適用", () => {
  beforeEach(() => {
    localStorage.removeItem("gymboard.themeColor");
    document.documentElement.removeAttribute("style");
  });

  it("id の読み替え: 無い・知らない → 既定、今の id → そのまま", () => {
    expect(resolveThemeColorId(null)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeColorId("")).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeColorId("no-such-color")).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeColorId("pink-dusty")).toBe("pink-dusty");
  });

  it("選んだ色を documentElement に入れ、端末に覚える", () => {
    applyThemeColor("pink-dusty");
    const p = THEME_COLORS.find((x) => x.id === "pink-dusty")!;
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(p.vars["--accent"]);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(p.vars["--primary"]);
    expect(localStorage.getItem("gymboard.themeColor")).toBe("pink-dusty");
    expect(getStoredThemeColor()).toBe("pink-dusty");
  });

  it("古い id で保存されていても読める", () => {
    localStorage.setItem("gymboard.themeColor", "blue");
    expect(getStoredThemeColor()).toBe(LEGACY_THEME_IDS.blue);
  });
});

describe("文言（5言語）", () => {
  for (const lang of LOCALES) {
    it(lang, () => {
      const s = JSON.parse(readFileSync(`src/locales/${lang}.json`, "utf8")).settings;
      for (const f of THEME_FAMILIES) expect(s.themeColors[f.id], `${lang} ${f.id}`).toBeTruthy();
      for (const tone of THEME_TONES) expect(s.themeTones[tone], `${lang} ${tone}`).toBeTruthy();
      expect(s.themeFamilyLabel).toBeTruthy();
      expect(s.themeToneLabel).toBeTruthy();
      expect(s.themeColorName).toContain("{{family}}");
      expect(s.themeColorName).toContain("{{tone}}");
      expect(s.themeColorDescription).toContain("64");
      // 色の名前は言語の中で重ならない（読み上げで区別できる）
      const names = THEME_FAMILIES.map((f) => s.themeColors[f.id]);
      expect(new Set(names).size, `${lang} 色の名前の重複`).toBe(names.length);
    });
  }
});
