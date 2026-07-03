// アプリの背景画像（端末ごとの個人設定）。
// テーマカラーと同様に localStorage に保存し、起動時に適用する（DB 不要・即時反映）。
// 見せ方は「すりガラス風」：写真を全面背景にし、カード等は既存のガラス仕様の
// フロスト面を流用する（themeColor.ts が theme-glass / theme-photo クラスを制御）。
// 画像は data URL を CSS 変数 --app-bg-image に渡して背景に適用する。
// 表示範囲はユーザーが「範囲を調整」エディタ（ドラッグで移動・ピンチで拡大縮小）で
// 決め、その切り抜き範囲(%)を --app-bg-size / --app-bg-position に変換して反映する。

import { resizeImageToJpeg } from "./imageResize";
import { setBackgroundPhotoActive } from "./themeColor";
import {
  analyzeBackgroundTone,
  applyBackgroundTone,
  getStoredBackgroundTone,
  storeBackgroundTone,
} from "./backgroundTone";

const STORAGE_KEY = "gymboard.backgroundImage";
const CONFIG_KEY = "gymboard.backgroundImageConfig";

/** react-easy-crop が返す切り抜き範囲（画像に対する%）。 */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BackgroundConfig {
  /**
   * 表示範囲（画像に対する%）。ユーザーがドラッグ/ピンチで決めた範囲。
   * null の場合は cover（画面いっぱい・中央）で表示する。
   */
  area: CropArea | null;
}

export const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = { area: null };

/** CSS の background へ反映する値。size が null のときは cover。 */
export interface BackgroundCss {
  /** background-size（%）。null は cover を意味する */
  size: number | null;
  /** background-position X（%） */
  posX: number;
  /** background-position Y（%） */
  posY: number;
}

function clampPct(n: number, fallback = 50): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

/**
 * 切り抜き範囲(%) から CSS の background-size / position(%) を導出する。
 * 切り抜き幅がコンテナ幅いっぱいになるよう画像を拡大（縦横比は維持）。
 * エディタのアスペクト比＝表示領域（画面）のアスペクト比なので、幅基準の
 * 拡大率だけで縦も収まる。
 */
export function areaToCss(area: CropArea | null): BackgroundCss {
  if (!area) return { size: null, posX: 50, posY: 50 };
  const w = clampPct(area.width, 100);
  const h = clampPct(area.height, 100);
  if (w <= 0 || h <= 0) return { size: null, posX: 50, posY: 50 };
  const size = 10000 / w;
  const posX = w >= 100 ? 50 : clampPct((area.x / (100 - w)) * 100);
  const posY = h >= 100 ? 50 : clampPct((area.y / (100 - h)) * 100);
  return { size, posX, posY };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 保存済みの背景画像（data URL）を返す。未設定なら null。 */
export function getStoredBackgroundImage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 保存済みの表示設定を返す（未設定・不正なら既定値）。 */
export function getBackgroundConfig(): BackgroundConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { area: null };
    const parsed = JSON.parse(raw) as { area?: Partial<CropArea> | null };
    const a = parsed.area;
    if (!a || typeof a !== "object") return { area: null };
    return {
      area: {
        x: Number.isFinite(a.x) ? (a.x as number) : 0,
        y: Number.isFinite(a.y) ? (a.y as number) : 0,
        width: Number.isFinite(a.width) ? (a.width as number) : 100,
        height: Number.isFinite(a.height) ? (a.height as number) : 100,
      },
    };
  } catch {
    return { area: null };
  }
}

/** 表示設定（切り抜き範囲）を CSS 変数に反映する。 */
export function applyBackgroundConfig(config: BackgroundConfig): void {
  const root = document.documentElement;
  const { size, posX, posY } = areaToCss(config.area);
  root.style.setProperty("--app-bg-size", size == null ? "cover" : `${size}%`);
  root.style.setProperty("--app-bg-position", `${posX}% ${posY}%`);
}

/** 表示設定を保存して即時反映する。表示範囲が変わると明暗も変わるためトーンを再解析。 */
export function setBackgroundConfig(config: BackgroundConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ area: config.area }));
  } catch {
    // ignore
  }
  applyBackgroundConfig(config);
  void recomputeBackgroundTone();
}

/** 背景画像を適用（null で解除）。画像 + 表示設定 + テーマクラス + 文字トーンを更新する。 */
export function applyBackgroundImage(dataUrl: string | null): void {
  const root = document.documentElement;
  if (dataUrl) {
    root.style.setProperty("--app-bg-image", `url("${dataUrl}")`);
    applyBackgroundConfig(getBackgroundConfig());
    setBackgroundPhotoActive(true);
    // 保存済みトーンを即適用（起動時のちらつき防止）。解析は呼び出し元で行う。
    applyBackgroundTone(getStoredBackgroundTone());
  } else {
    root.style.removeProperty("--app-bg-image");
    setBackgroundPhotoActive(false);
    applyBackgroundTone(null);
  }
}

/**
 * 背景写真の表示範囲を解析し、写真上の文字トーン（黒系/白系）を自動決定する。
 * 画像が無ければトーンを解除。解析失敗時は現状維持（既定の濃色文字）。
 */
async function recomputeBackgroundTone(): Promise<void> {
  const url = getStoredBackgroundImage();
  if (!url) {
    storeBackgroundTone(null);
    applyBackgroundTone(null);
    return;
  }
  const tone = await analyzeBackgroundTone(
    url,
    getBackgroundConfig().area,
    window.innerWidth,
    window.innerHeight,
  );
  if (tone) {
    storeBackgroundTone(tone);
    applyBackgroundTone(tone);
  }
}

/**
 * 端末の写真ファイルから背景を設定する。
 * 容量・表示負荷を抑えるため JPEG にリサイズ/圧縮してから保存する。
 * localStorage 容量超過時はさらに強めに圧縮して再試行する。失敗時は例外を投げる。
 * 新しい画像では表示範囲をリセットし、まず cover（画面いっぱい）で表示する。
 */
export async function setBackgroundImageFromFile(file: File): Promise<void> {
  let dataUrl = await blobToDataUrl(await resizeImageToJpeg(file, 1280, 0.72));
  try {
    localStorage.setItem(STORAGE_KEY, dataUrl);
  } catch {
    // 容量超過の可能性 → さらに圧縮して再試行（それでも失敗すれば呼び出し元へ）
    dataUrl = await blobToDataUrl(await resizeImageToJpeg(file, 1024, 0.5));
    localStorage.setItem(STORAGE_KEY, dataUrl);
  }
  // 前の写真のトーンを引き継がない（新しい写真の解析結果が出るまでは既定の濃色文字）
  storeBackgroundTone(null);
  setBackgroundConfig({ area: null }); // 内部で新しい画像のトーンを再解析する
  applyBackgroundImage(dataUrl);
}

/** 背景画像を削除して既定に戻す（表示設定・文字トーンも初期化）。 */
export function clearBackgroundImage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    // ignore
  }
  storeBackgroundTone(null);
  applyBackgroundConfig(DEFAULT_BACKGROUND_CONFIG);
  applyBackgroundImage(null);
}

// 画面の縦横が変わると cover 表示の可視領域が変わりトーンも変わり得るため、
// 回転時に再解析する。生の resize は Android のキーボード開閉でも発火するので
// orientation の matchMedia を使い、軽くデバウンスする。多重登録は防止。
let orientationWatchArmed = false;
function armOrientationRecompute(): void {
  if (orientationWatchArmed || typeof window.matchMedia !== "function") return;
  orientationWatchArmed = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void recomputeBackgroundTone(), 300);
  };
  try {
    window.matchMedia("(orientation: portrait)").addEventListener("change", onChange);
  } catch {
    // 古いWebViewは addEventListener 未対応（addListener は非推奨のため何もしない）
  }
}

/** 起動時に保存済みの背景画像・表示設定を適用する（main.tsx から呼ぶ）。 */
export function initBackgroundImage(): void {
  const url = getStoredBackgroundImage();
  if (url) {
    applyBackgroundImage(url); // 保存済みトーンを即適用（ちらつきなし）
    // 既存ユーザー（トーン未保存）や画面サイズ変化に備え、非同期で再解析して自己修復
    void recomputeBackgroundTone();
  }
  armOrientationRecompute();
}
