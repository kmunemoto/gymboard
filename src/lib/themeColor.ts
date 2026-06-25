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
  make("teal", "174 60% 45%", "174 65% 50%", "180 60% 55%"),
  make("blue", "214 70% 48%", "210 80% 52%", "198 85% 55%"),
  make("violet", "256 55% 56%", "262 70% 60%", "276 70% 64%"),
  make("rose", "342 65% 53%", "346 78% 58%", "356 80% 62%"),
  make("amber", "30 80% 50%", "36 90% 53%", "44 92% 55%"),
  make("green", "150 50% 40%", "148 55% 44%", "138 55% 48%"),
];

export const DEFAULT_THEME_ID = "teal";
const STORAGE_KEY = "gymboard.themeColor";

export function getStoredThemeColor(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
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

// 起動時に保存済みの色を適用する（main.tsx から呼ぶ）。
export function initThemeColor(): void {
  const id = getStoredThemeColor();
  const preset = THEME_COLORS.find((p) => p.id === id);
  if (!preset || preset.id === DEFAULT_THEME_ID) return; // 既定は index.css のまま
  const root = document.documentElement;
  Object.entries(preset.vars).forEach(([k, v]) => root.style.setProperty(k, v));
}
