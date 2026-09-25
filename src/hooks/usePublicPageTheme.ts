import { useEffect } from "react";
import { LEGACY_THEME_IDS, THEME_COLORS } from "@/lib/themeColor";

/**
 * 公開の予約ページ（体験・ドロップイン）の色を、ジムが決めた色に固定する（2026-09-25）。
 *
 * 宗本さん「私のジムの体験予約ページの色はオレンジ変えてティファニーブルーに固定して」。
 *
 * ## なぜオレンジになっていたか
 *
 * このページは独自の色を持たず、アプリ全体の色（`--primary` / `--accent` …）で描いている。
 * その色は**見ている端末の「テーマカラー」**（設定画面で選ぶ。localStorage）で決まる。
 * 初めて来るお客様の端末には設定が無いので既定（ティファニー系）で見えるが、
 * テーマカラーを変えたスタッフや会員の端末では、その色（オレンジ等）で見える。
 *
 * ## 何をするか
 *
 * `tenants.public_theme_color`（例 `"teal-soft"`）があるときだけ、このページを開いている間、
 *   - 色をその色にする
 *   - すりガラス・背景写真（端末ごとの見た目の設定）も外す
 * 離れたら元に戻す（同じタブでアプリに戻ったとき、その人の設定が生きているように）。
 *
 * 未設定（null）・知らない値なら**何もしない**＝今まで通り。ジムごとの設定なので、
 * 設定していないジムの見え方は変わらない。
 */
const DEVICE_LOOK_CLASSES = ["theme-glass", "theme-photo", "bg-tone-dark"] as const;

export const resolvePublicThemePreset = (themeId: string | null | undefined) => {
  if (!themeId) return null;
  const id = LEGACY_THEME_IDS[themeId] ?? themeId;
  return THEME_COLORS.find((p) => p.id === id) ?? null;
};

export function usePublicPageTheme(themeId: string | null | undefined): void {
  useEffect(() => {
    const preset = resolvePublicThemePreset(themeId);
    if (!preset) return;
    const root = document.documentElement;

    const prevVars = Object.keys(preset.vars).map((k) => [k, root.style.getPropertyValue(k)] as const);
    const prevClasses = DEVICE_LOOK_CLASSES.filter((c) => root.classList.contains(c));

    Object.entries(preset.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    prevClasses.forEach((c) => root.classList.remove(c));

    return () => {
      prevVars.forEach(([k, v]) => (v ? root.style.setProperty(k, v) : root.style.removeProperty(k)));
      prevClasses.forEach((c) => root.classList.add(c));
    };
  }, [themeId]);
}
