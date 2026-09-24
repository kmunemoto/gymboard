// テーマカラー 64色（16の色 × 4つのトーン）を作る（2026-09-24）。
//
// 宗本さん「テーマカラーを64色にしてください」「色を選ぶデザイン考えて。任せます」。
//
// ## 🔴 色は手で決めず、OKLCH（人の目に揃った色空間）から作る
//
// HSL で「彩度◯%・明度◯%」を全色に同じ値で入れると、黄色は明るすぎ・青は暗すぎになり、
// 白い文字が読めない色が混ざる（HSL の明度は目に見える明るさと揃っていない）。
// OKLCH の L（明るさ）を揃えると、色が変わっても明るさの見え方が揃う。
// ここでは「トーン＝L と C（鮮やかさ）の組」、「色＝色相 H」として掛け合わせる。
//
// ## 🔴 白い文字が乗る
//
// ボタン（bg-primary / bg-accent）には白い文字が乗る。新しく作る色は
// 白との比が 3:1 以上（WCAG の大きい文字・UI 部品の基準）になるように L を決めてあり、
// `src/test/themePalette.test.ts` が全色を計算して確かめている。
// 以前からの6色（既定のティールを含む）は、今までの見た目を変えないためにそのまま残す
// （themeColor.ts の LEGACY_COLORS）。こちらは比が 3:1 に届かないものもある。
//
// このファイルは計算だけ（DOM も localStorage も触らない）。

export const THEME_TONES = ["vivid", "soft", "dusty", "deep"] as const;
export type ThemeTone = (typeof THEME_TONES)[number];

/**
 * 16の色。H は OKLCH の色相（度）。以前からの6色（amber / green / teal / blue / violet、rose は近く）は
 * その色の実際の色相に合わせ、あいだを約20〜30度おきに埋めた（隣どうしが見分けられる間隔。テストが測っている）。
 * 並びは色相の順（画面の4×4もこの順に並ぶ）。最後だけ無彩色（グレー）。
 */
export const THEME_FAMILIES = [
  { id: "rose", hue: 8 },
  { id: "red", hue: 30 },
  { id: "orange", hue: 50 },
  { id: "amber", hue: 69 },
  { id: "mustard", hue: 92 },
  { id: "lime", hue: 122 },
  { id: "green", hue: 155 },
  { id: "teal", hue: 185 },
  { id: "cyan", hue: 210 },
  { id: "sky", hue: 232 },
  { id: "blue", hue: 253 },
  { id: "indigo", hue: 275 },
  { id: "violet", hue: 296 },
  { id: "magenta", hue: 322 },
  { id: "pink", hue: 345 },
  { id: "slate", hue: 255, neutral: true },
] as const satisfies readonly { id: string; hue: number; neutral?: boolean }[];
export type ThemeFamily = (typeof THEME_FAMILIES)[number]["id"];

/**
 * トーンごとの明るさ L と鮮やかさ C（OKLCH）。
 * C は「狙い」。その色相・明るさで画面に出せない（sRGB の外）ときは、出せるところまで下げる。
 * グレーは色みをほとんど持たせない（neutralC）。
 */
const TONE_SPEC: Record<ThemeTone, { l: number; c: number; neutralC: number }> = {
  vivid: { l: 0.6, c: 0.19, neutralC: 0.045 },
  soft: { l: 0.65, c: 0.1, neutralC: 0.03 },
  dusty: { l: 0.58, c: 0.065, neutralC: 0.012 },
  deep: { l: 0.42, c: 0.1, neutralC: 0.025 },
};

/** CSS に入れる3つ（HSL の "H S% L%"）。index.css のトークンと同じ形。 */
export interface ThemeTriple {
  primary: string;
  accent: string;
  accent2: string;
}

type Rgb = [number, number, number];

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** OKLCH → sRGB（0〜1）。画面に出せない色なら null。 */
const oklchToRgb = (l: number, c: number, hDeg: number): Rgb | null => {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m_ = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s_ = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const eps = 1e-6;
  if (lin.some((v) => v < -eps || v > 1 + eps)) return null;
  return lin.map((v) => toSrgb(Math.min(1, Math.max(0, v)))) as Rgb;
};

/** 画面に出せる範囲まで C を下げて変換する（L と H は変えない） */
const fitOklch = (l: number, c: number, h: number): Rgb => {
  const direct = oklchToRgb(l, c, h);
  if (direct) return direct;
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (oklchToRgb(l, mid, h)) lo = mid;
    else hi = mid;
  }
  return oklchToRgb(l, lo, h) ?? [l, l, l];
};

/** sRGB → "H S% L%"（整数に丸める。既存の6色と同じ書き方） */
export const rgbToHslTriple = ([r, g, b]: Rgb): string => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return `${Math.round(h) % 360} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

/**
 * 1色ぶんの3つを作る。
 *   accent  … その色そのもの
 *   primary … 色相を少し戻し、少し暗く（既存の6色と同じ関係。見出しのグラデーションの始点）
 *   accent2 … 色相を少し進め、少し明るく（グラデーションの終点）
 */
export const buildThemeTriple = (family: ThemeFamily, tone: ThemeTone): ThemeTriple => {
  const f = THEME_FAMILIES.find((x) => x.id === family)!;
  const spec = TONE_SPEC[tone];
  const neutral = "neutral" in f && f.neutral;
  const c = neutral ? spec.neutralC : spec.c;
  return {
    accent: rgbToHslTriple(fitOklch(spec.l, c, f.hue)),
    primary: rgbToHslTriple(fitOklch(spec.l - 0.03, c * 0.9, f.hue - 5)),
    accent2: rgbToHslTriple(fitOklch(spec.l + 0.03, c, f.hue + 8)),
  };
};

// ── 確かめ用（テストと、色を足すときの目安） ─────────────────────────

const parseTriple = (t: string): [number, number, number] => {
  const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/.exec(t);
  if (!m) throw new Error(`HSL の形ではない: ${t}`);
  return [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
};

export const hslTripleToRgb = (t: string): Rgb => {
  const [h, s, l] = parseTriple(t);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
};

/** 白い文字との比（WCAG 2） */
export const contrastWithWhite = (t: string): number => {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [r, g, b] = hslTripleToRgb(t).map(lin);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (y + 0.05);
};

/** OKLab（見た目の近さを比べる用） */
export const hslTripleToOklab = (t: string): [number, number, number] => {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const [r, g, b] = hslTripleToRgb(t).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
