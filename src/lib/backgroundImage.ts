// アプリの背景画像（端末ごとの個人設定）。
// テーマカラーと同様に localStorage に保存し、起動時に適用する（DB 不要・即時反映）。
// 見せ方は「すりガラス風」：写真を全面背景にし、カード等は既存のガラス仕様の
// フロスト面を流用する（themeColor.ts が theme-glass / theme-photo クラスを制御）。
// 画像は data URL を CSS 変数 --app-bg-image に渡して背景に適用する。
// 表示範囲（フィット・位置）はユーザーが設定欄で調整でき、--app-bg-size /
// --app-bg-position として反映する。

import { resizeImageToJpeg } from "./imageResize";
import { setBackgroundPhotoActive } from "./themeColor";

const STORAGE_KEY = "gymboard.backgroundImage";
const CONFIG_KEY = "gymboard.backgroundImageConfig";

export type BackgroundFit = "cover" | "contain";

export interface BackgroundConfig {
  /** cover=画面いっぱい(切り取り) / contain=画像全体を表示 */
  fit: BackgroundFit;
  /** 横位置 0–100(%) */
  posX: number;
  /** 縦位置 0–100(%) */
  posY: number;
}

export const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  fit: "cover",
  posX: 50,
  posY: 50,
};

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
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
    if (!raw) return { ...DEFAULT_BACKGROUND_CONFIG };
    const parsed = JSON.parse(raw) as Partial<BackgroundConfig>;
    return {
      fit: parsed.fit === "contain" ? "contain" : "cover",
      posX: clampPct(parsed.posX ?? 50),
      posY: clampPct(parsed.posY ?? 50),
    };
  } catch {
    return { ...DEFAULT_BACKGROUND_CONFIG };
  }
}

/** 表示設定（フィット・位置）を CSS 変数に反映する。 */
export function applyBackgroundConfig(config: BackgroundConfig): void {
  const root = document.documentElement;
  root.style.setProperty("--app-bg-size", config.fit);
  root.style.setProperty("--app-bg-position", `${clampPct(config.posX)}% ${clampPct(config.posY)}%`);
}

/** 表示設定を保存して即時反映する。 */
export function setBackgroundConfig(config: BackgroundConfig): void {
  const normalized: BackgroundConfig = {
    fit: config.fit === "contain" ? "contain" : "cover",
    posX: clampPct(config.posX),
    posY: clampPct(config.posY),
  };
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
  } catch {
    // ignore
  }
  applyBackgroundConfig(normalized);
}

/** 背景画像を適用（null で解除）。画像 + 表示設定 + テーマクラスを更新する。 */
export function applyBackgroundImage(dataUrl: string | null): void {
  const root = document.documentElement;
  if (dataUrl) {
    root.style.setProperty("--app-bg-image", `url("${dataUrl}")`);
    applyBackgroundConfig(getBackgroundConfig());
    setBackgroundPhotoActive(true);
  } else {
    root.style.removeProperty("--app-bg-image");
    setBackgroundPhotoActive(false);
  }
}

/**
 * 端末の写真ファイルから背景を設定する。
 * 容量・表示負荷を抑えるため JPEG にリサイズ/圧縮してから保存する。
 * localStorage 容量超過時はさらに強めに圧縮して再試行する。失敗時は例外を投げる。
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
  applyBackgroundImage(dataUrl);
}

/** 背景画像を削除して既定に戻す（表示設定も初期化）。 */
export function clearBackgroundImage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    // ignore
  }
  applyBackgroundConfig(DEFAULT_BACKGROUND_CONFIG);
  applyBackgroundImage(null);
}

/** 起動時に保存済みの背景画像・表示設定を適用する（main.tsx から呼ぶ）。 */
export function initBackgroundImage(): void {
  const url = getStoredBackgroundImage();
  if (url) applyBackgroundImage(url);
}
