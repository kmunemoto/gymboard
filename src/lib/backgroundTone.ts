// 背景写真の明暗を解析し、写真の上に直接乗る文字色（黒系/白系）を自動で決める。
// ガラス仕様（theme-photo）では白フロスト面の文字は常に濃色で読めるが、
// フロスト面の外（ページ見出し・補助テキスト等）は写真の明暗次第で読めなくなるため、
// 表示範囲の平均輝度から <html> に bg-tone-dark クラスを付け外しして自動切替する。
// 解析は端末内の canvas 縮小サンプリングで完結する（通信・AI API 不要、数十ms）。

import type { CropArea } from "./backgroundImage";

/** 背景のトーン。dark = 暗い背景（→ 文字は白系に反転） */
export type BackgroundTone = "light" | "dark";

const TONE_KEY = "gymboard.backgroundTone";
const TONE_CLASS = "bg-tone-dark";

// index.css theme-photo::before の暗幕（hsl(220 14% 12% / 0.18)）と一致させる。
// 表示時は写真にこの暗幕が重なるため、判定も暗幕込みの実効輝度で行う。
const SCRIM_ALPHA = 0.18;
const SCRIM_LUMA = 0.11; // hsl(220 14% 12%) の輝度近似

/** 画像内の「実際に画面に表示される範囲」（画像px）を求める。 */
export function visibleRegion(
  imgW: number,
  imgH: number,
  area: CropArea | null,
  viewW: number,
  viewH: number,
): { x: number; y: number; w: number; h: number } {
  if (imgW <= 0 || imgH <= 0) return { x: 0, y: 0, w: Math.max(1, imgW), h: Math.max(1, imgH) };
  if (area && area.width > 0 && area.height > 0) {
    // 範囲エディタで決めた切り抜き（画像に対する%）
    const x = Math.min(Math.max((area.x / 100) * imgW, 0), imgW - 1);
    const y = Math.min(Math.max((area.y / 100) * imgH, 0), imgH - 1);
    const w = Math.min((area.width / 100) * imgW, imgW - x);
    const h = Math.min((area.height / 100) * imgH, imgH - y);
    return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
  }
  // cover 表示: 画面アスペクト比で中央トリミングされる範囲
  if (viewW <= 0 || viewH <= 0) return { x: 0, y: 0, w: imgW, h: imgH };
  const scale = Math.max(viewW / imgW, viewH / imgH);
  const w = Math.min(imgW, viewW / scale);
  const h = Math.min(imgH, viewH / scale);
  return { x: (imgW - w) / 2, y: (imgH - h) / 2, w: Math.max(1, w), h: Math.max(1, h) };
}

/**
 * ダウンサンプル済みピクセル(RGBA)の加重平均輝度（0..1）。
 * 画面上部にはページ見出し・ヘッダーが乗るため、上部1/3は2倍の重みで評価する。
 */
export function weightedMeanLuma(data: Uint8ClampedArray, w: number, h: number): number {
  if (w <= 0 || h <= 0 || data.length < w * h * 4) return 0.5;
  let sum = 0;
  let weightSum = 0;
  for (let y = 0; y < h; y++) {
    const weight = y < h / 3 ? 2 : 1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Rec.709 luma 近似（ガンマ空間のままの簡易輝度。黒白判定にはこれで十分）
      const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      sum += luma * weight;
      weightSum += weight;
    }
  }
  return weightSum > 0 ? sum / weightSum : 0.5;
}

/** 平均輝度（暗幕を重ねる前）からトーンを判定する。 */
export function decideToneFromLuma(meanLuma: number): BackgroundTone {
  const effective = meanLuma * (1 - SCRIM_ALPHA) + SCRIM_LUMA * SCRIM_ALPHA;
  return effective < 0.5 ? "dark" : "light";
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 背景画像（data URL）の表示範囲を解析してトーンを返す。
 * 解析できない環境・失敗時は null（既定の濃色文字のまま）。
 */
export async function analyzeBackgroundTone(
  dataUrl: string,
  area: CropArea | null,
  viewW: number,
  viewH: number,
): Promise<BackgroundTone | null> {
  try {
    const img = await loadImage(dataUrl);
    const reg = visibleRegion(img.naturalWidth, img.naturalHeight, area, viewW, viewH);
    const W = 48;
    const H = 48;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, reg.x, reg.y, reg.w, reg.h, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    return decideToneFromLuma(weightedMeanLuma(data, W, H));
  } catch {
    return null;
  }
}

/** 保存済みトーン（未保存・不正は null）。 */
export function getStoredBackgroundTone(): BackgroundTone | null {
  try {
    const v = localStorage.getItem(TONE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

/** トーンを保存する（null で削除）。 */
export function storeBackgroundTone(tone: BackgroundTone | null): void {
  try {
    if (tone) localStorage.setItem(TONE_KEY, tone);
    else localStorage.removeItem(TONE_KEY);
  } catch {
    // ignore
  }
}

/** トーンを <html> クラスに反映する（dark のときだけ bg-tone-dark を付与）。 */
export function applyBackgroundTone(tone: BackgroundTone | null): void {
  document.documentElement.classList.toggle(TONE_CLASS, tone === "dark");
}
