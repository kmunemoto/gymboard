// アプリの背景画像（端末ごとの個人設定）。
// テーマカラーと同様に localStorage に保存し、起動時に適用する（DB 不要・即時反映）。
// 見せ方は「すりガラス風」：写真を全面背景にし、カード等は既存のガラス仕様の
// フロスト面を流用する（themeColor.ts が theme-glass / theme-photo クラスを制御）。
// 画像は data URL を CSS 変数 --app-bg-image に渡して body 背景に適用する。

import { resizeImageToJpeg } from "./imageResize";
import { setBackgroundPhotoActive } from "./themeColor";

const STORAGE_KEY = "gymboard.backgroundImage";

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

/** 背景画像を適用（null で解除）。CSS 変数とテーマクラスを更新する。 */
export function applyBackgroundImage(dataUrl: string | null): void {
  const root = document.documentElement;
  if (dataUrl) {
    root.style.setProperty("--app-bg-image", `url("${dataUrl}")`);
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

/** 背景画像を削除して既定に戻す。 */
export function clearBackgroundImage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  applyBackgroundImage(null);
}

/** 起動時に保存済みの背景画像を適用する（main.tsx から呼ぶ）。 */
export function initBackgroundImage(): void {
  const url = getStoredBackgroundImage();
  if (url) applyBackgroundImage(url);
}
