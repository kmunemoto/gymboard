import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
// URLスキームと本番ドメインは製品ごとに違うため src/lib/brand.ts に集約している
// （兄弟アプリはそちらだけ差し替える。mem/ops/vertical-fork.md）。
import { NATIVE_APP_SCHEME, PRODUCTION_WEB_ORIGIN } from '@/lib/brand';
import { isSafeInAppPath } from "@/lib/safePath";
import { isSafeHttpUrl } from "@/lib/linkify";

export const isNative = () => Capacitor.isNativePlatform();

export async function openExternalUrl(url: string) {
  // 🔴 http(s) 以外は開かない（2026-11-01・点検の拡大 tenant-contact-url-1）。ジムの「LINEで連絡」「Google口コミ」の URL は
  //    オーナーが API で入れられ、javascript: を入れると、押したお客様の画面でスクリプトが動いてセッションを盗めた
  //    （DB にも CHECK を足した: 20261101090000。ここは古い行・今後の別の画面の守り）。
  if (!isSafeHttpUrl(url)) {
    console.warn("[nativeBridge] http(s) 以外の URL は開きません");
    return;
  }
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
  // 🔴 "/" 始まりは isSafeInAppPath で見る（2026-10-31 点検 auth-callback-next-1）。以前の
  //    「/ で始まり // で始まらない」だけでは、"/\evil.example"・"/<タブ>/evil.example" が通り、
  //    ブラウザが https://evil.example/ に解決していた（通知を開く側と同じ判定にそろえた）。
  if (next.startsWith('/')) return isSafeInAppPath(next) ? next : null;
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

export function getWebOrigin() {
  if (isNative()) {
    return PRODUCTION_WEB_ORIGIN;
  }
  return window.location.origin;
}
