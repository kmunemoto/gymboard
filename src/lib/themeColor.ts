// GymBoard 共通: アプリのアクセントカラー（テーマ色）を端末ごとに切り替える。
// CSS の HSL トークン（--primary / --accent など）を documentElement に上書きする方式。
// localStorage に保存し、起動時に適用する（DB 不要・即時反映・全テナント共通機能）。
// 既定(teal)の値は index.css の初期値と一致するため、未選択時の見た目は変わらない。

import {
  THEME_FAMILIES, THEME_TONES, buildThemeTriple,
  type ThemeFamily, type ThemeTone, type ThemeTriple,
} from "@/lib/themePalette";

export type { ThemeFamily, ThemeTone } from "@/lib/themePalette";
export { THEME_FAMILIES, THEME_TONES } from "@/lib/themePalette";

// 🔴 64色（16の色 × 4つのトーン）に増やした（2026-09-24）。色の作り方は themePalette.ts。
//    id は `${色}-${トーン}`（例: "teal-soft"）。

export interface ThemeColorPreset {
  id: string;
  family: ThemeFamily;
  tone: ThemeTone;
  /** i18n キー（色の名前）。トーン名と組み合わせて「ティール・ビビッド」のように出す */
  nameKey: string;
  /** i18n キー（トーンの名前） */
  toneKey: string;
  /** スウォッチ表示に使う代表色（HSL トリプル） */
  swatch: string;
  /** documentElement に設定する CSS 変数（HSL トリプル） */
  vars: Record<string, string>;
}

const make = (family: ThemeFamily, tone: ThemeTone, { primary, accent, accent2 }: ThemeTriple): ThemeColorPreset => ({
  id: `${family}-${tone}`,
  family,
  tone,
  nameKey: `settings.themeColors.${family}`,
  toneKey: `settings.themeTones.${tone}`,
  swatch: accent,
  vars: {
    "--primary": primary,
    "--accent": accent,
    "--accent-2": accent2,
    "--ring": accent,
    "--sidebar-primary": primary,
    "--sidebar-ring": accent,
  },
});

/**
 * 🔴 以前からの6色。**値を1文字も変えない**（選んでいた人の見た目を変えないため）。
 *    64色のうち、いちばん近いトーンの枠に置く。ティールだけ「ソフト」
 *    （新しく作ったソフトとほぼ同じ色だった。ビビッドに置くと、ソフトと見分けがつかない
 *    2色が並ぶ）。ほかの5色は「ビビッド」。
 *    保存してある古い id（"teal" 等）は LEGACY_THEME_IDS で読み替える。
 */
export const LEGACY_COLORS: Partial<Record<ThemeFamily, { tone: ThemeTone; triple: ThemeTriple }>> = {
  teal: { tone: "soft", triple: { primary: "174 60% 45%", accent: "174 63% 39%", accent2: "180 58% 41%" } },
  blue: { tone: "vivid", triple: { primary: "214 70% 48%", accent: "210 80% 52%", accent2: "198 85% 55%" } },
  violet: { tone: "vivid", triple: { primary: "256 55% 56%", accent: "262 70% 60%", accent2: "276 70% 64%" } },
  rose: { tone: "vivid", triple: { primary: "342 65% 53%", accent: "346 78% 58%", accent2: "356 80% 62%" } },
  amber: { tone: "vivid", triple: { primary: "30 80% 50%", accent: "36 90% 53%", accent2: "44 92% 55%" } },
  green: { tone: "vivid", triple: { primary: "150 50% 40%", accent: "148 55% 44%", accent2: "138 55% 48%" } },
};

/** 6色だったころの id → 今の id */
export const LEGACY_THEME_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_COLORS).map(([f, v]) => [f, `${f}-${v!.tone}`]),
);

const tripleFor = (family: ThemeFamily, tone: ThemeTone): ThemeTriple => {
  const legacy = LEGACY_COLORS[family];
  return legacy && legacy.tone === tone ? legacy.triple : buildThemeTriple(family, tone);
};

/** 並びは「色の順 → トーンの順」。画面の4×4とトーンの列はこの順に出す。 */
export const THEME_COLORS: ThemeColorPreset[] = THEME_FAMILIES.flatMap((f) =>
  THEME_TONES.map((tone) => make(f.id, tone, tripleFor(f.id, tone))),
);

/** 既定＝以前からのティール（index.css の初期値と同じ色） */
export const DEFAULT_THEME_ID = "teal-soft";

export const findThemeColor = (family: ThemeFamily, tone: ThemeTone): ThemeColorPreset =>
  THEME_COLORS.find((p) => p.family === family && p.tone === tone) ??
  THEME_COLORS.find((p) => p.id === DEFAULT_THEME_ID)!;

/** 保存してある id を今の id に直す（古い id・知らない id も受ける）。知らなければ既定 */
export const resolveThemeColorId = (raw: string | null | undefined): string => {
  if (!raw) return DEFAULT_THEME_ID;
  const id = LEGACY_THEME_IDS[raw] ?? raw;
  return THEME_COLORS.some((p) => p.id === id) ? id : DEFAULT_THEME_ID;
};

const STORAGE_KEY = "gymboard.themeColor";
const GLASS_KEY = "gymboard.glassMode";

export function getStoredThemeColor(): string {
  try {
    return resolveThemeColorId(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_ID;
  }
}

// ガラス仕様（すりガラス風の半透明デザイン）の保存/取得/適用。
// documentElement に theme-glass クラスを付与し、index.css の glass スタイルを有効化する。
// 配色は選択中のテーマカラー（--accent 等）で色づくため「各カラーごと」に見え方が変わる。
export function getStoredGlassMode(): boolean {
  try {
    return localStorage.getItem(GLASS_KEY) === "1";
  } catch {
    return false;
  }
}

// 背景写真が有効かどうか。写真背景はガラス仕様のフロスト面を流用するため、
// 写真が有効な間は theme-glass も付与する（backgroundImage.ts から通知される）。
let backgroundPhotoActive = false;

// theme-glass / theme-photo クラスを、ガラス設定と背景写真の状態から再計算する。
function reconcileFrostClasses(): void {
  const root = document.documentElement;
  root.classList.toggle("theme-glass", getStoredGlassMode() || backgroundPhotoActive);
  root.classList.toggle("theme-photo", backgroundPhotoActive);
}

// 背景写真の有効/無効を通知する（backgroundImage.ts から呼ぶ）。
export function setBackgroundPhotoActive(active: boolean): void {
  backgroundPhotoActive = active;
  reconcileFrostClasses();
}

export function applyGlassMode(on: boolean): void {
  try {
    localStorage.setItem(GLASS_KEY, on ? "1" : "0");
  } catch {
    // ignore
  }
  reconcileFrostClasses();
}

export function applyThemeColor(id: string): void {
  const resolved = resolveThemeColorId(id);
  const preset = THEME_COLORS.find((p) => p.id === resolved)!;
  const root = document.documentElement;
  Object.entries(preset.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  try {
    localStorage.setItem(STORAGE_KEY, preset.id);
  } catch {
    // ignore (private mode 等)
  }
}

// 起動時に保存済みの色・ガラス設定を適用する（main.tsx から呼ぶ）。
export function initThemeColor(): void {
  const id = getStoredThemeColor();
  const preset = THEME_COLORS.find((p) => p.id === id);
  // 既定（以前からのティール）は index.css の初期値のまま（上書きしない＝今まで通り）
  if (preset && preset.id !== DEFAULT_THEME_ID) {
    const root = document.documentElement;
    Object.entries(preset.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }
  reconcileFrostClasses();
}
