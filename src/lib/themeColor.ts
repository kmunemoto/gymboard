// GymBoard 共通: アプリのアクセントカラー（テーマ色）を端末ごとに切り替える。
// CSS の HSL トークン（--primary / --accent など）を documentElement に上書きする方式。
// localStorage に保存し、起動時に適用する（DB 不要・即時反映・全テナント共通機能）。
// 既定(teal)の値は index.css の初期値と一致するため、未選択時の見た目は変わらない。

export interface ThemeColorPreset {
  id: string;
  /** i18n キー（色名・aria-label 用） */
  nameKey: string;
  /** スウォッチ表示に使う代表色（HSL トリプル） */
  swatch: string;
  /** documentElement に設定する CSS 変数（HSL トリプル） */
  vars: Record<string, string>;
}

const make = (id: string, primary: string, accent: string, accent2: string): ThemeColorPreset => ({
  id,
  nameKey: `settings.themeColors.${id}`,
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

export const THEME_COLORS: ThemeColorPreset[] = [
  make("teal", "174 60% 45%", "174 63% 39%", "180 58% 41%"),
  make("blue", "214 70% 48%", "210 80% 52%", "198 85% 55%"),
  make("violet", "256 55% 56%", "262 70% 60%", "276 70% 64%"),
  make("rose", "342 65% 53%", "346 78% 58%", "356 80% 62%"),
  make("amber", "30 80% 50%", "36 90% 53%", "44 92% 55%"),
  make("green", "150 50% 40%", "148 55% 44%", "138 55% 48%"),
];

export const DEFAULT_THEME_ID = "teal";
const STORAGE_KEY = "gymboard.themeColor";
const GLASS_KEY = "gymboard.glassMode";

export function getStoredThemeColor(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID;
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
  const preset = THEME_COLORS.find((p) => p.id === id) ?? THEME_COLORS[0];
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
  if (preset && preset.id !== DEFAULT_THEME_ID) {
    const root = document.documentElement;
    Object.entries(preset.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  }
  reconcileFrostClasses();
}
