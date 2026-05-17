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
