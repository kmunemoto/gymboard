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

// ネイティブアプリの確認メール/コールバックが使うカスタムURLスキーム。
// getAuthCallbackUrl() とサニタイズ側の両方でこの1箇所だけを見るようにし、
// 文字列のコピーによるズレを防ぐ。
const NATIVE_APP_SCHEME = 'app.gymboard.mobile:';

export function getAuthCallbackUrl() {
  if (isNative()) {
    return `${NATIVE_APP_SCHEME}//auth/callback`;
  }
  return `${window.location.origin}/auth/callback`;
}

/**
 * AuthCallback の `next` パラメータ（メール確認後の遷移先）を検証する。
 * オープンリダイレクト対策: 攻撃者が
 *   https://app.kyoto-salute.com/auth/callback?token_hash=...&next=https://evil.example
 * のようなURLを確認メールに見せかけて送ると、確認処理の直後に任意サイトへ飛ばせてしまう。
 *
 * 許可するのは3つだけ:
 *   1. "/" で始まる相対パス（"//" 始まりは除く。ブラウザがプロトコル相対URLとして
 *      別ホストに飛ぶため）
 *   2. 自オリジンと一致する絶対URL
 *   3. ネイティブアプリのカスタムURLスキーム（アプリ内で登録して確認したユーザーを
 *      メールからアプリへ戻すための正規の遷移先。supabase/functions/auth-email-hook が
 *      emailRedirectTo をそのまま next に載せて送ってくる）
 * それ以外（http/https の他ホスト、javascript: など）は破棄して null を返す。
 */
export function sanitizeAuthNext(next: string | null | undefined): string | null {
  if (!next) return null;
  if (next.startsWith('/') && !next.startsWith('//')) return next;
  try {
    const u = new URL(next, window.location.origin);
    if (u.origin === window.location.origin || u.protocol === NATIVE_APP_SCHEME) {
      return next;
    }
  } catch {
    // 不正なURL文字列は破棄
  }
  return null;
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
