import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

export const isNative = () => Capacitor.isNativePlatform();

export async function openExternalUrl(url: string) {
  if (isNative()) {
    try {
      await Browser.open({ url });
      return;
    } catch (e) {
      console.warn('[nativeBridge] Browser.open failed, falling back', e);
    }
  }
  window.open(url, '_blank');
}

export function getAuthCallbackUrl() {
  if (isNative()) {
    return 'app.gymboard.mobile://auth/callback';
  }
  return `${window.location.origin}/auth/callback`;
}

// GymBoard 本体の本番 Web ドメイン。ネイティブアプリ内では window.location.origin が
// 'capacitor://localhost' に解決されてしまい、招待リンク・体験予約リンクなど「コピーして
// 他人に共有する」リンクがそのままでは開けなくなる（誰も capacitor:// を解決できないため）。
// ネイティブ時はこの本番ドメインにフォールバックする。
// 注意: 'app.gymboard.app' は DNS が存在しない未設定ドメインだったため、実際に生きている
// 本番ドメイン 'app.kyoto-salute.com' に修正済み（2026-07、共有リンクが開けない不具合の調査より）。
const PRODUCTION_WEB_ORIGIN = 'https://app.kyoto-salute.com';

export function getWebOrigin() {
  if (isNative()) {
    return PRODUCTION_WEB_ORIGIN;
  }
  return window.location.origin;
}
