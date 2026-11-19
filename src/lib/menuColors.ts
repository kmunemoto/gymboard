/**
 * 店側の予定表で、予約をメニューごとに色分けする（2026-11-19）。
 *
 * 宗本さん「トレーニングとピラティスみたいな、トレーニングに合わせて予約の色変えれる？
 * このジム側のスケジュールの画面」。色の決め方は「自動で色分けだけ」（設定は増やさない）を選んだ。
 *
 * - いつものメニュー（担当のいない先頭＝トレーニング）と、メニューの無い予約は**今の色のまま**
 *   （テーマ色＝`bg-accent`）。メニューが1つ以下の店は何も変わらない
 * - ほかのメニューには、端末のテーマ色と**同じトーン**で、色相がテーマ色からいちばん離れた色を順に当てる。
 *   色は themePalette の64色から作る（白い文字との比 3:1 以上がテストで保証されている色）
 * - テーマ色は端末ごと（localStorage）なので、メニューの色も端末ごとに違ってよい（同じ端末では毎回同じ）
 * - 当てる順は「受付中のメニューが先・同じなら並び順」。使っていないメニュー（例: 外したヨガ）に
 *   いちばん見分けやすい色を取られないため
 *
 * DB には何も足していない（見た目だけ）。凡例は MenuColorLegend、見張りは src/test/menuColors.test.tsx。
 */
import type { CSSProperties } from "react";
import { THEME_FAMILIES, buildThemeTriple, type ThemeFamily, type ThemeTone } from "@/lib/themePalette";
import { THEME_COLORS, getStoredThemeColor } from "@/lib/themeColor";
import { defaultMenu, type BookingMenu } from "@/lib/bookingMenus";

export interface ThemeRef {
  family: ThemeFamily;
  tone: ThemeTone;
}

/** メニューの色（HSL トリプル）。accent が塗り、accent2 はグラデーションの終点 */
export interface MenuColor {
  accent: string;
  accent2: string;
}

/** テーマ色からこれより近い色相は使わない（同じ色に見える） */
export const MIN_HUE_FROM_THEME = 60;

/** 色相どうしの距離（0〜180度） */
export const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const isNeutral = (f: (typeof THEME_FAMILIES)[number]): boolean => "neutral" in f && f.neutral === true;

/** この端末で選んでいるテーマ色（読めなければ既定のティール） */
export const currentThemeRef = (): ThemeRef => {
  const id = getStoredThemeColor();
  const preset = THEME_COLORS.find((p) => p.id === id) ?? THEME_COLORS.find((p) => p.id === "teal-soft")!;
  return { family: preset.family, tone: preset.tone };
};

/**
 * メニューごとの色。値が null のメニューは今の色（テーマ色）。
 * メニューが2つ未満の店は空（＝全部今の色）。
 */
export const menuColorMap = (
  menus: ReadonlyArray<BookingMenu>,
  theme: ThemeRef,
): Map<string, MenuColor | null> => {
  const map = new Map<string, MenuColor | null>();
  if (menus.length < 2) return map;

  const base = defaultMenu(menus);
  if (base) map.set(base.id, null);

  const themeFamily = THEME_FAMILIES.find((f) => f.id === theme.family);
  // グレーのテーマには色相が無いので、どの色も「離れている」とみなす
  const themeHue = themeFamily && !isNeutral(themeFamily) ? themeFamily.hue : null;
  const candidates = THEME_FAMILIES.filter(
    (f) => !isNeutral(f) && (themeHue === null || hueDistance(f.hue, themeHue) >= MIN_HUE_FROM_THEME),
  );

  const others = menus
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.id !== base?.id)
    .sort((a, b) => Number(b.m.is_active) - Number(a.m.is_active) || a.i - b.i)
    .map(({ m }) => m);

  const used: number[] = themeHue === null ? [] : [themeHue];
  let remaining = [...candidates];
  for (const m of others) {
    // 色が尽きたら（メニューが10個を超える店）最初からもう一周する
    if (remaining.length === 0) remaining = [...candidates];
    // テーマ色と、もう使った色から、いちばん離れた色（同点なら色相の順で先のもの）
    let bestIdx = 0;
    let bestScore = -1;
    remaining.forEach((f, idx) => {
      const score = used.length === 0 ? 180 : Math.min(...used.map((h) => hueDistance(f.hue, h)));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    const [picked] = remaining.splice(bestIdx, 1);
    used.push(picked.hue);
    const triple = buildThemeTriple(picked.id, theme.tone);
    map.set(m.id, { accent: triple.accent, accent2: triple.accent2 });
  }
  return map;
};

/** その予約の色。今の色（テーマ色）のときは null */
export const menuColorOf = (
  colors: ReadonlyMap<string, MenuColor | null>,
  menuId: string | null | undefined,
): MenuColor | null => (menuId ? (colors.get(menuId) ?? null) : null);

/**
 * HSL トリプル（"185 30% 45%"）を CSS の色にする。
 * カンマ区切り（`hsl(185, 30%, 45%)`）にするのは、どの WebView でも読めて、テスト（jsdom）でも
 * 色として読めるため（空白区切りは jsdom が読めず、色のテストが空どうしの比較で素通りしていた）。
 */
export const hslCss = (triple: string): string => `hsl(${triple.trim().split(/\s+/).join(", ")})`;

/** 週の予定表のカード（塗り）。文字は白 */
export const menuFillStyle = (c: MenuColor): CSSProperties => ({
  backgroundColor: hslCss(c.accent),
  color: "#fff",
});

/** 日の予定表のカード・頭文字の四角（accent-gradient と同じ向きのグラデーション）。文字は白 */
export const menuGradientStyle = (c: MenuColor): CSSProperties => ({
  backgroundImage: `linear-gradient(135deg, ${hslCss(c.accent)}, ${hslCss(c.accent2)})`,
  color: "#fff",
});
